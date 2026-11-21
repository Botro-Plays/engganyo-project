import { test, expect, type Page } from '@playwright/test';

/**
 * Support chat widget — viewport-safe placement and interaction.
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
    // A >5px drag is a drag, not a click — the chat stays closed.
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
    const vh = page.viewportSize()!.height;
    // Sheet spans nearly the full width and anchors to the bottom edge.
    expect(sheet!.width).toBeGreaterThanOrEqual(vw - 40);
    expect(vh - (sheet!.y + sheet!.height)).toBeLessThanOrEqual(24);

    const input = page.getByLabel('Chat message');
    await expect(input).toBeFocused();
    await input.fill('Test from mobile');
    await page.getByLabel('Send message').click();
    await expect(dialog.getByText('Test from mobile')).toBeVisible();

    await page.getByLabel('Close chat').click();
    await expect(dialog).toHaveCount(0);
  });

  test('minimize hides the composer but keeps the header', async ({ page }) => {
    await mockChatApi(page);
    await gotoDashboard(page);
    await page.locator(LAUNCHER).click();
    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible();

    await page.getByLabel('Minimize chat').click();
    await expect(page.getByLabel('Chat message')).toHaveCount(0);
    await expect(dialog.getByText('Engganyo Support')).toBeVisible();
    await insideViewport(page, DIALOG);
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
      await page.getByLabel('Send message').click();
      await expect(dialog.getByText(`Message number ${i}`)).toBeVisible();
      // Wait for the mocked reply so isLoading releases the input.
      await expect(dialog.getByText('Mocked support reply from e2e.').last()).toBeVisible();
    }

    const scroller = dialog.locator('[data-no-drag]');
    const metrics = await scroller.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
    }));
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    // Auto-scrolled to the newest message.
    expect(metrics.scrollTop + metrics.clientHeight).toBeGreaterThanOrEqual(
      metrics.scrollHeight - 4,
    );
  });
});
