import { test, expect } from '@playwright/test';

const UNIQUE = () => Date.now().toString(36);

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(/email or username/i).fill(process.env['E2E_TEST_EMAIL'] ?? 'admin@engganyo.com');
  await page.getByLabel(/password/i).fill(process.env['E2E_TEST_PASSWORD'] ?? 'Admin@123456');
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 20_000 });
}

async function fillNewTopicForm(page: import('@playwright/test').Page, title: string, content: string) {
  await page.goto('/forum/new');
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder(/what's your topic about/i).fill(title);
  await page.locator('textarea').first().fill(content);
}

test.describe('Forum (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('forum listing page loads and shows topics', async ({ page }) => {
    await page.goto('/forum');
    await expect(page).toHaveURL(/forum/);
    await expect(page.getByRole('heading', { name: /forum/i }).first()).toBeVisible({ timeout: 5_000 });
  });

  test('can navigate to new topic page', async ({ page }) => {
    await page.goto('/forum');
    await page.waitForLoadState('networkidle');
    const newTopicBtn = page.getByRole('link', { name: /new topic/i });
    if (await newTopicBtn.count() > 0) {
      await newTopicBtn.first().click();
      await expect(page).toHaveURL(/forum\/new/, { timeout: 5_000 });
    }
  });

  test('create a new forum topic', async ({ page }) => {
    const uid = UNIQUE();
    await fillNewTopicForm(
      page,
      `E2E Test Topic ${uid}`,
      `This is an automated E2E test topic body ${uid}. It has enough content to pass validation.`,
    );
    await page.getByRole('button', { name: /create topic/i }).click();
    await page.waitForURL(/forum\/[a-z0-9-]+/, { timeout: 15_000 });
    await expect(page.getByText(`E2E Test Topic ${uid}`)).toBeVisible({ timeout: 5_000 });
  });

  test('can view a topic and post a reply', async ({ page }) => {
    const uid = UNIQUE();

    await fillNewTopicForm(
      page,
      `Reply Test Topic ${uid}`,
      `Topic body for reply test ${uid} with enough content to pass validation checks.`,
    );
    await page.getByRole('button', { name: /create topic/i }).click();
    await page.waitForURL(/forum\/[a-z0-9-]+/, { timeout: 15_000 });

    await page.waitForLoadState('networkidle');
    const replyArea = page.locator('textarea').first();
    await replyArea.fill(`This is a test reply ${uid} with enough content to satisfy minimum length.`);
    await page.getByRole('button', { name: 'Reply', exact: true }).first().click();

    await expect(page.getByText(`This is a test reply ${uid}`)).toBeVisible({ timeout: 5_000 });
  });

  test('locked topic shows locked indicator', async ({ page }) => {
    await page.goto('/forum');
    await page.waitForLoadState('networkidle');
    const lockedIcon = page.locator('svg.text-yellow-400, [class*="yellow"]').first();
    if (await lockedIcon.count() > 0) {
      const topicLink = lockedIcon.locator('xpath=ancestor::a').first();
      if (await topicLink.count() > 0) {
        await topicLink.click();
        await expect(page.getByText(/locked/i).first()).toBeVisible({ timeout: 5_000 });
      }
    }
  });

  test('forum listing filters by status', async ({ page }) => {
    await page.goto('/forum');
    await page.waitForLoadState('networkidle');

    const pinnedFilter = page.getByRole('button', { name: 'Pinned', exact: true });
    if (await pinnedFilter.count() > 0) {
      await pinnedFilter.click();
    }

    const allFilter = page.getByRole('button', { name: 'All', exact: true });
    if (await allFilter.count() > 0) {
      await allFilter.click();
    }
  });

  test('topic author can edit their topic', async ({ page }) => {
    const uid = UNIQUE();

    await fillNewTopicForm(
      page,
      `Editable Topic ${uid}`,
      `Original content for edit test ${uid} with enough body text here.`,
    );
    await page.getByRole('button', { name: /create topic/i }).click();
    await page.waitForURL(/forum\/[a-z0-9-]+/, { timeout: 15_000 });
    await page.waitForLoadState('networkidle');

    const editBtn = page.locator('button').filter({ hasText: '✏️' }).first();
    if (await editBtn.count() > 0) {
      await editBtn.click();
      const titleInput = page.locator('input[type="text"]').first();
      await titleInput.fill(`Edited Topic ${uid}`);
      await page.getByRole('button', { name: /save/i }).click();
      await expect(page.getByText(`Edited Topic ${uid}`)).toBeVisible({ timeout: 5_000 });
    }
  });

  test('can react to a topic', async ({ page }) => {
    await page.goto('/forum');
    await page.waitForLoadState('networkidle');

    const topicLink = page.locator('a[href*="/forum/"]:not([href="/forum/new"])').first();
    if (await topicLink.count() > 0) {
      await topicLink.click();
      await page.waitForURL(/forum\/[a-z0-9-]+/, { timeout: 5_000 });
      await page.waitForLoadState('networkidle');

      const likeBtn = page.locator('button').filter({ hasText: '👍' }).first();
      if (await likeBtn.count() > 0) {
        await likeBtn.click();
        await page.waitForTimeout(500);
        await expect(likeBtn).toHaveClass(/indigo|bg-indigo/, { timeout: 3_000 });
      }
    }
  });
});

test.describe('Forum (admin moderation)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('admin forum management page loads', async ({ page }) => {
    await page.goto('/admin/forum');
    await expect(page).toHaveURL(/admin\/forum/);
    await expect(page.getByRole('heading', { name: /forum/i }).first()).toBeVisible({ timeout: 5_000 });
  });

  test('admin can lock and unlock a topic', async ({ page }) => {
    await page.goto('/admin/forum');
    await page.waitForLoadState('networkidle');

    // Find the first OPEN topic row that has a Lock button
    const lockBtn = page.locator('button[title="Lock"]').first();
    if (await lockBtn.count() > 0) {
      await lockBtn.click();
      await page.waitForLoadState('networkidle');
      // After locking, an Unlock button should appear
      const unlockBtn = page.locator('button[title="Unlock"]').first();
      await expect(unlockBtn).toBeVisible({ timeout: 5_000 });
      // Clean up: unlock it again
      await unlockBtn.click();
    }
  });
});
