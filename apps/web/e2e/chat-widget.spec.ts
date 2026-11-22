import { test, expect, type Page } from '@playwright/test';

/**
 * Support chat widget - viewport-safe placement and interaction.
 *
 * Covers:
 * - Launcher fully inside the viewport at 320/360/390/768/1440px.
 * - Mobile launcher clears the dashboard bottom nav; open state is a
 *   bottom sheet, not a free-floating panel.
 * - Desktop open state is a docked panel; dragging is clamped so the
 *   widget can never leave the viewport.
 * - Invalid/out-of-range persisted offsets recover to the dock instead
 *   of stranding the launcher off-screen.
 * - Open, close (button + Escape), typing, send, and message scrolling.
 */

test.use({ storageState: 'e2e/.auth/user.json' });

const LAUNCHER = 'button[aria-label="Open support chat"]';
const DIALOG = 'div[role="dialog"][aria-label="Engganyo support chat"]';

async function mockChatApi(page: Page) {
  await page.route('**/api/chat', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          message: 'Mocked support reply from e2e.',
          conversationId: 'e2e-conv-1',
          isHuman: false,
          status: 'open',
        },
        timestamp: new Date().toISOString(),
      }),
    });
  });
}

async function gotoDashboard(page: Page) {
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
}

const insideViewport = async (page: Page, selector: string) => {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} should be measurable`).not.toBeNull();
  const vw = page.viewportSize()!.width;
  const vh = page.viewportSize()!.height;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vw);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
  return box!;
};


// ── Simulated software-keyboard geometry ────────────────────────────────
// Playwright can't drive a real IME, so these cases replace
// window.visualViewport with an EventTarget whose height/offsetTop the
// test controls. innerHeight stays the layout height; the difference
// simulates the occluded strip a keyboard leaves. This is SIMULATED
// keyboard coverage - real-device acceptance remains owner-assisted.
async function installFakeVisualViewport(page: Page) {
  await page.addInitScript(() => {
    const target = new EventTarget();
    let h = window.innerHeight;
    let top = 0;
    const g = (k: string, fn: () => number) =>
      Object.defineProperty(target, k, { get: fn });
    g('height', () => h);
    g('offsetTop', () => top);
    g('offsetLeft', () => 0);
    g('width', () => window.innerWidth);
    g('scale', () => 1);
    g('pageTop', () => top);
    g('pageLeft', () => 0);
    (window as unknown as { __vvSet: (a: number, b: number) => void }).__vvSet =
      (height: number, offsetTop: number) => {
        h = height;
        top = offsetTop;
        target.dispatchEvent(new Event('resize'));
      };
    Object.defineProperty(window, 'visualViewport', {
      value: target,
      configurable: true,
    });
  });
}

function setVisibleViewport(page: Page, height: number, offsetTop: number) {
  return page.evaluate(
    ([a, b]) =>
      (window as unknown as { __vvSet: (x: number, y: number) => void }).__vvSet(a, b),
    [height, offsetTop],
  );
}

// Assert the whole sheet plus its reachable controls sit inside the
// simulated visible region [vvTop, vvTop + vvH] of the layout viewport.
async function expectSheetInsideVisible(
  page: Page,
  vvH: number,
  vvTop: number,
) {
  const box = await page.locator(DIALOG).boundingBox();
  expect(box, 'sheet should be measurable').not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(vvTop);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vvTop + vvH + 1);

  for (const sel of [
    'button[aria-label="Close chat"]',
    'button[aria-label="Send message"]',
  ]) {
    const b = await page.locator(sel).boundingBox();
    expect(b, `${sel} should be measurable`).not.toBeNull();
    expect(b!.y).toBeGreaterThanOrEqual(vvTop);
    expect(b!.y + b!.height).toBeLessThanOrEqual(vvTop + vvH + 1);
  }
}

test.describe('launcher placement across widths', () => {
  for (const width of [320, 360, 390, 768, 1440]) {
    test(`stays fully inside viewport @${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await gotoDashboard(page);
      await expect(page.locator(LAUNCHER)).toBeVisible();
      await insideViewport(page, LAUNCHER);
    });
  }

  test('clears the mobile bottom nav @390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDashboard(page);
    const launcher = await page.locator(LAUNCHER).boundingBox();
    const nav = await page.locator('nav[aria-label="Mobile navigation"]').boundingBox();
    expect(launcher).not.toBeNull();
    expect(nav).not.toBeNull();
    expect(launcher!.y + launcher!.height).toBeLessThanOrEqual(nav!.y);
  });

  test('recovers an out-of-range persisted offset', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('chat-widget-pos', JSON.stringify({ x: 99999, y: -99999 }));
    });
    await gotoDashboard(page);
    await expect(page.locator(LAUNCHER)).toBeVisible();
    await insideViewport(page, LAUNCHER);
  });

  test('recovers a malformed persisted offset', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('chat-widget-pos', '{"x":"far","y":null}');
    });
    await gotoDashboard(page);
    await expect(page.locator(LAUNCHER)).toBeVisible();
    await insideViewport(page, LAUNCHER);
  });
});

test.describe('desktop dock @1440px', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('dragging the launcher is clamped to the viewport', async ({ page }) => {
    await gotoDashboard(page);
    const launcher = page.locator(LAUNCHER);
    const box = await launcher.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(box!.x - i * 200, box!.y - i * 150);
    }
    await page.mouse.up();

    const after = await launcher.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.x).toBeGreaterThanOrEqual(0);
    expect(after!.y).toBeGreaterThanOrEqual(0);
    // Dragging far past the top-left corner must not strand it off-screen.
    expect(after!.x + after!.width).toBeGreaterThanOrEqual(after!.width);
    // A >5px drag is a drag, not a click - the chat stays closed.
    await expect(page.locator(DIALOG)).toHaveCount(0);
  });

  test('opens a docked panel, sends a message, closes via Escape', async ({ page }) => {
    await mockChatApi(page);
    await gotoDashboard(page);
    await page.locator(LAUNCHER).click();

    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible();
    await insideViewport(page, DIALOG);
    // Desktop panel is right-docked, not a full-width sheet.
    const panel = await dialog.boundingBox();
    expect(panel!.width).toBeLessThanOrEqual(420);

    const input = page.getByLabel('Chat message');
    await expect(input).toBeFocused();
    await input.fill('How do I earn credits?');
    await page.keyboard.press('Enter');

    await expect(dialog.getByText('How do I earn credits?')).toBeVisible();
    await expect(dialog.getByText('Mocked support reply from e2e.')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(LAUNCHER)).toBeVisible();
    // Focus returns to the launcher for keyboard users.
    await expect(page.locator(LAUNCHER)).toBeFocused();
  });

  test('opening the panel does not scroll the underlying page', async ({ page }) => {
    await mockChatApi(page);
    // The homepage is a long document - real document scroll to verify.
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    // html { scroll-behavior: smooth } makes a plain scrollTo animate -
    // use 'instant' and wait for the value to land before measuring.
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }));
    await page.waitForFunction(() => window.scrollY > 100);
    const before = await page.evaluate(() => window.scrollY);
    await page.locator(LAUNCHER).click();
    await expect(page.locator(DIALOG)).toBeVisible();
    // Autofocus + layout must not pull the document.
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    await page.getByRole('button', { name: 'Minimize chat' }).click();
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  });
});

test.describe('mobile sheet @390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens as a bottom sheet, sends a message, closes via button', async ({ page }) => {
    await mockChatApi(page);
    await gotoDashboard(page);
    await page.locator(LAUNCHER).click();

    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible();
    await insideViewport(page, DIALOG);

    const sheet = await dialog.boundingBox();
    const vw = page.viewportSize()!.width;
    // Sheet spans nearly the full width.
    expect(sheet!.width).toBeGreaterThanOrEqual(vw - 40);
    // Its bottom edge clears the dashboard mobile nav so the composer is
    // never overlapped by the fixed nav strip.
    const nav = await page.locator('nav[aria-label="Mobile navigation"]').boundingBox();
    expect(nav).not.toBeNull();
    expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(nav!.y + 1);

    const input = page.getByLabel('Chat message');
    await expect(input).toBeFocused();
    await input.fill('Test from mobile');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(dialog.getByText('Test from mobile')).toBeVisible();

    await page.getByRole('button', { name: 'Close chat' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('minimize hides the composer but keeps the header', async ({ page }) => {
    await mockChatApi(page);
    await gotoDashboard(page);
    await page.locator(LAUNCHER).click();
    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible();

    await page.getByRole('button', { name: 'Minimize chat' }).click();
    await expect(page.getByLabel('Chat message')).toHaveCount(0);
    await expect(dialog.getByText('Engganyo Support')).toBeVisible();
    await insideViewport(page, DIALOG);
  });
});

test.describe('short landscape viewport (keyboard-open shape)', () => {
  // Below the sm breakpoint with 200px visible height approximates the
  // space left above a software keyboard in landscape - the sheet must
  // still fit header + messages + composer inside the visible area.
  test.use({ viewport: { width: 600, height: 200 } });

  test('header, messages and composer stay inside the visible viewport', async ({ page }) => {
    await mockChatApi(page);
    await gotoDashboard(page);
    await page.locator(LAUNCHER).click();

    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible();
    await insideViewport(page, DIALOG);

    const input = page.getByLabel('Chat message');
    await expect(input).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();

    const send = await page.getByRole('button', { name: 'Send message' }).boundingBox();
    const vh = page.viewportSize()!.height;
    expect(send!.y + send!.height).toBeLessThanOrEqual(vh);

    await input.fill('Landscape check');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(dialog.getByText('Landscape check')).toBeVisible();
    await expect(dialog.getByText('Mocked support reply from e2e.')).toBeVisible();
  });
});

test.describe('message list scrolling', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('long conversations scroll and keep the latest message reachable', async ({ page }) => {
    await mockChatApi(page);
    await gotoDashboard(page);
    await page.locator(LAUNCHER).click();
    const dialog = page.locator(DIALOG);
    const input = page.getByLabel('Chat message');

    for (let i = 1; i <= 8; i++) {
      await input.fill(`Message number ${i}`);
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect(dialog.getByText(`Message number ${i}`)).toBeVisible();
      // Wait for the mocked reply so isLoading releases the input.
      await expect(dialog.getByText('Mocked support reply from e2e.').last()).toBeVisible();
    }

    const scroller = dialog.locator('[data-no-drag]');
    const metrics = await scroller.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    // Smooth scrolling is async - poll until the newest message is reached.
    await expect
      .poll(
        () =>
          scroller.evaluate((el) => el.scrollTop + el.clientHeight),
        { timeout: 5_000 },
      )
      .toBeGreaterThanOrEqual(metrics.scrollHeight - 4);
  });
});

test.describe('sheet height budget vs visible viewport (simulated keyboard)', () => {
  // Layout viewport fixed at 390x800; the faked visualViewport models the
  // keyboard-occluded strip (innerHeight - vv.height - vv.offsetTop).
  // Dashboard pages render the fixed mobile nav; the homepage has none.
  test.use({ viewport: { width: 390, height: 800 } });

  const CASES: { vvH: number; vvTop: number; nav: boolean }[] = [
    { vvH: 350, vvTop: 0, nav: true },
    { vvH: 350, vvTop: 40, nav: false },
    { vvH: 400, vvTop: 0, nav: true },
    { vvH: 400, vvTop: 0, nav: false },
    { vvH: 500, vvTop: 0, nav: true },
    { vvH: 500, vvTop: 60, nav: false },
    { vvH: 600, vvTop: 0, nav: true },
    { vvH: 600, vvTop: 0, nav: false },
  ];

  for (const c of CASES) {
    test(`vv ${c.vvH}+${c.vvTop} ${c.nav ? 'with nav in DOM' : 'no nav'}: sheet stays fully visible`, async ({
      page,
    }) => {
      await installFakeVisualViewport(page);
      await mockChatApi(page);
      if (c.nav) {
        await gotoDashboard(page);
      } else {
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await setVisibleViewport(page, c.vvH, c.vvTop);
      await page.locator(LAUNCHER).click();
      await expect(page.locator(DIALOG)).toBeVisible();
      await expectSheetInsideVisible(page, c.vvH, c.vvTop);
      await expect(page.getByLabel('Chat message')).toBeVisible();
    });
  }

  test('partially visible nav: sheet rests above it when there is room', async ({ page }) => {
    await installFakeVisualViewport(page);
    await mockChatApi(page);
    await gotoDashboard(page);
    // vv 780 of 800: the nav's top edge (~740) pokes into the visible
    // region, so the sheet should anchor just above it.
    await setVisibleViewport(page, 780, 0);
    await page.locator(LAUNCHER).click();
    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible();
    await expectSheetInsideVisible(page, 780, 0);
    const nav = await page.locator('nav[aria-label="Mobile navigation"]').boundingBox();
    const sheet = await dialog.boundingBox();
    expect(nav).not.toBeNull();
    expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(nav!.y + 1);
  });

  test('cramped heights cover the nav but keep every control inside', async ({ page }) => {
    await installFakeVisualViewport(page);
    await mockChatApi(page);
    await gotoDashboard(page);
    // vv 250: clearing the nav would leave < 200px, so the sheet covers
    // it (z-60) - but the whole sheet must stay inside the visible area.
    await setVisibleViewport(page, 250, 0);
    await page.locator(LAUNCHER).click();
    await expect(page.locator(DIALOG)).toBeVisible();
    await expectSheetInsideVisible(page, 250, 0);
    const send = page.getByRole('button', { name: 'Send message' });
    await expect(send).toBeVisible();
    await page.getByLabel('Chat message').fill('Cramped');
    await send.click();
    await expect(page.locator(DIALOG).getByText('Cramped')).toBeVisible();
  });
});

// ── Mobile launcher touch dragging ─────────────────────────────────────
// Synthetic PointerEvents drive the pointer-capture drag path. Real
// device acceptance (finger feel, capture edge cases) stays
// owner-assisted.

const LAUNCHER_POS_KEY = 'chat-widget-pos-mobile';

async function pointerDrag(
  page: Page,
  from: { x: number; y: number },
  steps: { x: number; y: number }[],
) {
  const launcher = page.locator(LAUNCHER);
  await launcher.dispatchEvent('pointerdown', {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    clientX: from.x,
    clientY: from.y,
    bubbles: true,
  });
  for (const pt of steps) {
    await launcher.dispatchEvent('pointermove', {
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      clientX: pt.x,
      clientY: pt.y,
      bubbles: true,
    });
  }
  return launcher;
}

test.describe('mobile launcher drag @390px', () => {
  test.use({ hasTouch: true });
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDashboard(page);
    await expect(page.locator(LAUNCHER)).toBeVisible();
  });

  test('touch drag repositions without opening chat; persists across reload', async ({
    page,
  }) => {
    const before = (await page.locator(LAUNCHER).boundingBox())!;
    const launcher = await pointerDrag(page, { x: before.x + 24, y: before.y + 24 }, [
      { x: before.x + 100, y: before.y - 100 },
      { x: before.x + 150, y: before.y - 160 },
    ]);
    await launcher.dispatchEvent('pointerup', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: before.x + 150,
      clientY: before.y - 160,
      bubbles: true,
    });
    // Trailing click after the drag must NOT open the sheet.
    // detail: 1 = pointer-origin click (detail 0 is the keyboard path).
    await launcher.dispatchEvent('click', {
      clientX: before.x + 150,
      clientY: before.y - 160,
      bubbles: true,
      detail: 1,
    });
    await expect(page.locator(DIALOG)).toHaveCount(0);
    // transition-all animates left/top - let it settle before measuring.
    await page.waitForTimeout(400);
    const after = (await page.locator(LAUNCHER).boundingBox())!;
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(40);
    await insideViewport(page, LAUNCHER);
    // Above the nav, not over it.
    const nav = await page.locator('nav[aria-label="Mobile navigation"]').boundingBox();
    expect(nav).not.toBeNull();
    expect(after.y + after.height).toBeLessThanOrEqual(nav!.y);

    // Position survives a reload.
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await expect(page.locator(LAUNCHER)).toBeVisible();
    await page.waitForTimeout(400); // mPos applies post-mount; transition-all animates it
    const reloaded = (await page.locator(LAUNCHER).boundingBox())!;
    expect(Math.abs(reloaded.x - after.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(reloaded.y - after.y)).toBeLessThanOrEqual(4);
  });

  test('plain tap still opens the sheet', async ({ page }) => {
    const box = (await page.locator(LAUNCHER).boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await pointerDrag(page, { x: cx, y: cy }, []);
    await page.locator(LAUNCHER).dispatchEvent('pointerup', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: cx,
      clientY: cy,
      bubbles: true,
    });
    await page.locator(LAUNCHER).dispatchEvent('click', {
      clientX: cx,
      clientY: cy,
      bubbles: true,
      detail: 1,
    });
    await expect(page.locator(DIALOG)).toBeVisible();
  });

  test('interrupted drag (pointercancel) keeps last point, no open', async ({ page }) => {
    const before = (await page.locator(LAUNCHER).boundingBox())!;
    const launcher = await pointerDrag(page, { x: before.x + 24, y: before.y + 24 }, [
      { x: before.x + 90, y: before.y - 60 },
      { x: before.x + 120, y: before.y - 80 },
    ]);
    await launcher.dispatchEvent('pointercancel', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: before.x + 120,
      clientY: before.y - 80,
      bubbles: true,
    });
    // pointercancel produces no click - nothing arrives to consume the
    // suppression flag, which is exactly the stale-state case under test.
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await page.waitForTimeout(400); // position prop transitions settle
    const after = (await page.locator(LAUNCHER).boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeGreaterThan(30);
    // A genuine next tap must open chat: a cancelled drag leaves no
    // stale suppression behind.
    await page.touchscreen.tap(after.x + after.width / 2, after.y + after.height / 2);
    await expect(page.locator(DIALOG)).toBeVisible();
  });

  test('keyboard activation opens chat after a cancelled drag', async ({
    page,
  }) => {
    const before = (await page.locator(LAUNCHER).boundingBox())!;
    const launcher = await pointerDrag(page, { x: before.x + 24, y: before.y + 24 }, [
      { x: before.x + 90, y: before.y - 60 },
    ]);
    await launcher.dispatchEvent('pointercancel', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: before.x + 90,
      clientY: before.y - 60,
      bubbles: true,
    });
    // Enter fires a click with detail 0 - independent of suppression.
    await launcher.press('Enter');
    await expect(page.locator(DIALOG)).toBeVisible();
  });

  test('lost pointer capture ends the gesture; next tap opens', async ({
    page,
  }) => {
    const before = (await page.locator(LAUNCHER).boundingBox())!;
    const launcher = await pointerDrag(page, { x: before.x + 24, y: before.y + 24 }, [
      { x: before.x + 90, y: before.y - 60 },
    ]);
    // lostpointercapture is a real boundary: the browser can drop
    // capture on interrupted gestures with no pointerup/cancel.
    await launcher.dispatchEvent('lostpointercapture', {
      pointerId: 7,
      pointerType: 'touch',
      bubbles: true,
    });
    await expect(page.locator(DIALOG)).toHaveCount(0);
    const after = (await page.locator(LAUNCHER).boundingBox())!;
    await page.touchscreen.tap(after.x + after.width / 2, after.y + after.height / 2);
    await expect(page.locator(DIALOG)).toBeVisible();
  });

  test('a second pointer cannot hijack the active gesture', async ({
    page,
  }) => {
    const before = (await page.locator(LAUNCHER).boundingBox())!;
    const launcher = await pointerDrag(page, { x: before.x + 24, y: before.y + 24 }, [
      { x: before.x + 90, y: before.y - 60 },
    ]);
    const mid = (await page.locator(LAUNCHER).boundingBox())!;
    // An unrelated pointer id must be ignored by the move/end handlers.
    await launcher.dispatchEvent('pointermove', {
      pointerId: 9,
      pointerType: 'touch',
      clientX: before.x + 300,
      clientY: before.y - 300,
      bubbles: true,
    });
    const after9 = (await page.locator(LAUNCHER).boundingBox())!;
    expect(Math.abs(after9.x - mid.x)).toBeLessThanOrEqual(6);
    expect(Math.abs(after9.y - mid.y)).toBeLessThanOrEqual(6);
    await launcher.dispatchEvent('pointerup', {
      pointerId: 9,
      pointerType: 'touch',
      bubbles: true,
    });
    // Pointer 7 still owns the gesture: it ends normally and its
    // trailing click is suppressed like any real drag click.
    await launcher.dispatchEvent('pointerup', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: before.x + 90,
      clientY: before.y - 60,
      bubbles: true,
    });
    await launcher.dispatchEvent('click', { bubbles: true, detail: 1 });
    await expect(page.locator(DIALOG)).toHaveCount(0);
  });

  test('launcher position tracks the pointer during the move itself', async ({
    page,
  }) => {
    const before = (await page.locator(LAUNCHER).boundingBox())!;
    const launcher = page.locator(LAUNCHER);
    await launcher.dispatchEvent('pointerdown', {
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      clientX: before.x + 24,
      clientY: before.y + 24,
      bubbles: true,
    });
    // Continuous movement asserted mid-gesture, not after a settle:
    // left/top sit outside the transition list so each move must land
    // immediately at the clamped spot.
    const targetX = before.x + 100;
    const targetY = before.y - 120;
    await launcher.dispatchEvent('pointermove', {
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      clientX: targetX + 24,
      clientY: targetY + 24,
      bubbles: true,
    });
    const mid = (await page.locator(LAUNCHER).boundingBox())!;
    expect(Math.abs(mid.x - targetX)).toBeLessThanOrEqual(12);
    expect(Math.abs(mid.y - targetY)).toBeLessThanOrEqual(12);
    await launcher.dispatchEvent('pointerup', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: targetX + 24,
      clientY: targetY + 24,
      bubbles: true,
    });
    await launcher.dispatchEvent('click', { bubbles: true, detail: 1 });
    await expect(page.locator(DIALOG)).toHaveCount(0);
  });

  test('genuine touchscreen tap opens chat', async ({ page }) => {
    const box = (await page.locator(LAUNCHER).boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator(DIALOG)).toBeVisible();
  });

  test('drag clamps at viewport edges and stays off the nav', async ({ page }) => {
    const before = (await page.locator(LAUNCHER).boundingBox())!;
    // Fling hard to the bottom-right - past the nav.
    const launcher = await pointerDrag(page, { x: before.x + 24, y: before.y + 24 }, [
      { x: 999, y: 999 },
    ]);
    await launcher.dispatchEvent('pointerup', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: 999,
      clientY: 999,
      bubbles: true,
    });
    await page.waitForTimeout(400); // transition-all animates left/top
    const after = (await page.locator(LAUNCHER).boundingBox())!;
    const nav = await page.locator('nav[aria-label="Mobile navigation"]').boundingBox();
    expect(after.x + after.width).toBeLessThanOrEqual(390);
    expect(after.y + after.height).toBeLessThanOrEqual(nav!.y);
  });

  test('reset control restores the default position', async ({ page }) => {
    const before = (await page.locator(LAUNCHER).boundingBox())!;
    const launcher = await pointerDrag(page, { x: before.x + 24, y: before.y + 24 }, [
      { x: before.x + 120, y: before.y - 120 },
    ]);
    await launcher.dispatchEvent('pointerup', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: before.x + 120,
      clientY: before.y - 120,
      bubbles: true,
    });
    const reset = page.locator('button[aria-label="Reset chat button position"]');
    await expect(reset).toBeVisible();
    await reset.click();
    await page.waitForTimeout(400); // transition-all animates left/top
    const restored = (await page.locator(LAUNCHER).boundingBox())!;
    expect(Math.abs(restored.x - before.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(restored.y - before.y)).toBeLessThanOrEqual(4);
    // Stored spot is cleared too - a reload must not resurrect it.
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    const reloaded = (await page.locator(LAUNCHER).boundingBox())!;
    expect(Math.abs(reloaded.x - before.x)).toBeLessThanOrEqual(4);
  });

  test('rotation re-clamps a saved spot inside the new viewport', async ({ page }) => {
    await page.addInitScript(
      ([key]) => localStorage.setItem(key as string, JSON.stringify({ x: 340, y: 600 })),
      [LAUNCHER_POS_KEY],
    );
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(400); // transition-all animates left/top
    await expect(page.locator(LAUNCHER)).toBeVisible();
    await insideViewport(page, LAUNCHER);
    // Rotate: 844x390 landscape - the saved 600px-tall spot is out of range.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(400); // re-clamp + transition settle
    await expect(page.locator(LAUNCHER)).toBeVisible();
    await insideViewport(page, LAUNCHER);
  });

  test('keyboard-open shrink re-clamps the saved spot (simulated)', async ({ page }) => {
    await installFakeVisualViewport(page);
    await page.addInitScript(
      ([key]) => localStorage.setItem(key as string, JSON.stringify({ x: 300, y: 720 })),
      [LAUNCHER_POS_KEY],
    );
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await expect(page.locator(LAUNCHER)).toBeVisible();
    // Keyboard opens: visible region drops to 420px tall.
    await setVisibleViewport(page, 420, 0);
    await page.waitForTimeout(400); // re-clamp + transition-all settle
    await expect(page.locator(LAUNCHER)).toBeVisible();
    const box = (await page.locator(LAUNCHER).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(420 + 1);
  });
});


test.describe('mobile and desktop spots are independent', () => {
  test('mobile drag does not disturb the desktop dock offset', async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem('chat-widget-pos', JSON.stringify({ x: -120, y: -60 })),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDashboard(page);
    const before = (await page.locator(LAUNCHER).boundingBox())!;
    const launcher = await pointerDrag(page, { x: before.x + 24, y: before.y + 24 }, [
      { x: before.x + 140, y: before.y - 100 },
    ]);
    await launcher.dispatchEvent('pointerup', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: before.x + 140,
      clientY: before.y - 100,
      bubbles: true,
    });
    const mobileBox = (await page.locator(LAUNCHER).boundingBox())!;
    // Widen to desktop: the dock offset (-120,-60) applies, not the mobile spot.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(LAUNCHER)).toBeVisible();
    const desktopBox = (await page.locator(LAUNCHER).boundingBox())!;
    expect(desktopBox).not.toEqual(mobileBox);
    // Desktop dock: right-aligned at right-6 minus the -120 x offset.
    expect(desktopBox.x + desktopBox.width).toBeLessThanOrEqual(1440 - 24 + 1);
    await insideViewport(page, LAUNCHER);
  });
});
