import { test, expect } from '@playwright/test';
import { renderContentWithMentions } from '../src/lib/render-content';

// These pages are public; keep cookie consent resolved so the banner can't cover controls.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cookie-consent', 'all'));
});

test.describe('check-email resend form', () => {
  test('email field has an accessible name and validation wires aria-invalid/describedby', async ({ page }) => {
    await page.route('**/auth/resend-verification', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }),
    );

    await page.goto('/check-email'); // no ?email= param -> typed input is shown
    const input = page.getByRole('textbox', { name: 'Email address' });
    await expect(input).toBeVisible();
    await expect(input).not.toHaveAttribute('aria-invalid', 'true');
    await expect(input).not.toHaveAttribute('aria-describedby', /.+/);

    // Empty submit -> validation error associated with the field.
    await page.getByRole('button', { name: 'Resend verification email' }).click();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAttribute('aria-describedby', 'check-email-error');
    await expect(page.locator('#check-email-error')).toHaveText('Please enter your email address.');

    // Invalid format -> different message, still associated.
    await input.fill('not-an-email');
    await page.getByRole('button', { name: 'Resend verification email' }).click();
    await expect(page.locator('#check-email-error')).toHaveText('Please enter a valid email address.');
  });

  test('Enter submits like the button, and repeats during loading send one request', async ({ page }) => {
    let requests = 0;
    await page.route('**/auth/resend-verification', async (route) => {
      requests += 1;
      await new Promise((r) => setTimeout(r, 700)); // hold the request open while loading
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
    });

    await page.goto('/check-email');
    const input = page.getByRole('textbox', { name: 'Email address' });
    await input.fill('user@example.com');

    await input.press('Enter'); // same path as clicking the button
    // While the first request is in flight, Enter presses must not duplicate it.
    await input.press('Enter');
    await input.press('Enter');
    await page.getByRole('button', { name: 'Sending…' }).waitFor();

    await expect(page.getByText('New verification link sent!')).toBeVisible();
    expect(requests).toBe(1);
  });
});

test.describe('legal pages', () => {
  for (const path of ['/privacy', '/terms']) {
    test(`${path} renders without the stray empty divider`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // The audit removed an empty bordered div; there should be no empty bordered element left.
      await expect(page.locator('div.border-t:empty')).toHaveCount(0);
    });
  }
});

test.describe('renderContentWithMentions', () => {
  // Flatten the returned React tree (no DOM needed) and collect rendered elements.
  function flatten(node: unknown, acc: { type: unknown; props: Record<string, unknown> }[] = []) {
    if (!node || typeof node !== 'object') return acc;
    const el = node as { props?: { children?: unknown }; type?: unknown };
    if (el.type && typeof el.type !== 'symbol' && el.props) acc.push(el as never);
    const children = el.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) flatten(child, acc);
    return acc;
  }

  test('usernames with reserved URL characters are encoded in profile links', () => {
    const node = renderContentWithMentions('check @[a/b?c#d e](user:u-1) out');
    const links = flatten(node).filter((el) => typeof (el.props as { href?: unknown }).href === 'string');
    const userLink = links.find((el) => String(el.props.href).startsWith('/users/'));
    expect(userLink).toBeTruthy();
    expect(userLink!.props.href).toBe('/users/a%2Fb%3Fc%23d%20e');
  });

  test('malformed content stays as inert text; campaign mentions link to /tasks', () => {
    const node = renderContentWithMentions('plain <img src=x onerror=alert(1)> and ![Promo](campaign:c-1)');
    const links = flatten(node).filter((el) => typeof (el.props as { href?: unknown }).href === 'string');
    // The raw HTML is a plain string child (React escapes it); only the mention became a link.
    expect(links).toHaveLength(1);
    expect(links[0]!.props.href).toBe('/tasks');
  });
});
