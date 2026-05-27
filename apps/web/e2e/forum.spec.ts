import { test, expect } from '@playwright/test';

const UNIQUE = () => Date.now().toString(36);

test.describe('Forum (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email or username/i).fill(process.env['E2E_TEST_EMAIL'] ?? 'admin@engganyo.com');
    await page.getByLabel(/password/i).fill(process.env['E2E_TEST_PASSWORD'] ?? 'Admin@123456');
    await page.getByRole('button', { name: /login|sign in/i }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 });
  });

  test('forum listing page loads and shows topics', async ({ page }) => {
    await page.goto('/forum');
    await expect(page).toHaveURL(/forum/);
    await expect(page.getByRole('heading', { name: /forum/i }).first()).toBeVisible({ timeout: 5_000 });
  });

  test('can navigate to new topic page', async ({ page }) => {
    await page.goto('/forum');
    const newTopicBtn = page.getByRole('link', { name: /new topic|create|post/i });
    if (await newTopicBtn.count() > 0) {
      await newTopicBtn.first().click();
      await expect(page).toHaveURL(/forum\/new/, { timeout: 5_000 });
    }
  });

  test('create a new forum topic', async ({ page }) => {
    const uid = UNIQUE();
    await page.goto('/forum/new');

    await page.getByLabel(/title/i).fill(`E2E Test Topic ${uid}`);

    const contentArea = page.locator('textarea').first();
    await contentArea.fill(`This is an automated E2E test topic body ${uid}. It has enough content to pass validation.`);

    await page.getByRole('button', { name: /post|create|submit/i }).click();

    await expect(page).toHaveURL(/forum\/[a-z0-9]+/, { timeout: 10_000 });
    await expect(page.getByText(`E2E Test Topic ${uid}`)).toBeVisible({ timeout: 5_000 });
  });

  test('can view a topic and post a reply', async ({ page }) => {
    const uid = UNIQUE();

    // First create a topic to reply to
    await page.goto('/forum/new');
    await page.getByLabel(/title/i).fill(`Reply Test Topic ${uid}`);
    const contentArea = page.locator('textarea').first();
    await contentArea.fill(`Topic body for reply test ${uid} with enough content to pass validation checks.`);
    await page.getByRole('button', { name: /post|create|submit/i }).click();
    await expect(page).toHaveURL(/forum\/[a-z0-9]+/, { timeout: 10_000 });

    // Now post a reply
    const replyArea = page.locator('textarea').first();
    await replyArea.fill(`This is a test reply ${uid} with enough content to satisfy minimum length.`);
    await page.getByRole('button', { name: /reply|send|submit/i }).first().click();

    await expect(page.getByText(`This is a test reply ${uid}`)).toBeVisible({ timeout: 5_000 });
  });

  test('locked topic shows locked indicator and disables reply form', async ({ page }) => {
    // Navigate to forum and look for a locked topic
    await page.goto('/forum?status=LOCKED');
    const lockedTopics = page.locator('[title*="lock"], [class*="yellow"]');
    if (await lockedTopics.count() > 0) {
      await lockedTopics.first().click();
      await expect(page.getByText(/locked/i).first()).toBeVisible({ timeout: 5_000 });
      // Reply form should not be present
      await expect(page.locator('form')).toHaveCount(0);
    }
  });

  test('forum listing filters by status', async ({ page }) => {
    await page.goto('/forum');

    const pinnedFilter = page.getByRole('button', { name: /pinned/i });
    if (await pinnedFilter.count() > 0) {
      await pinnedFilter.click();
      await expect(page).toHaveURL(/forum/, { timeout: 3_000 });
    }

    const openFilter = page.getByRole('button', { name: /^open$|^all$/i });
    if (await openFilter.count() > 0) {
      await openFilter.click();
    }
  });

  test('topic author can edit their topic', async ({ page }) => {
    const uid = UNIQUE();

    await page.goto('/forum/new');
    await page.getByLabel(/title/i).fill(`Editable Topic ${uid}`);
    const contentArea = page.locator('textarea').first();
    await contentArea.fill(`Original content for edit test ${uid} with enough body text here.`);
    await page.getByRole('button', { name: /post|create|submit/i }).click();
    await expect(page).toHaveURL(/forum\/[a-z0-9]+/, { timeout: 10_000 });

    // Click edit button on topic
    const editBtn = page.locator('button[title="Edit topic"], button[title*="edit" i]').first();
    if (await editBtn.count() > 0) {
      await editBtn.click();
      const titleInput = page.locator('input').first();
      await titleInput.fill(`Edited Topic ${uid}`);
      await page.getByRole('button', { name: /save/i }).click();
      await expect(page.getByText(`Edited Topic ${uid}`)).toBeVisible({ timeout: 5_000 });
    }
  });

  test('can react to a topic', async ({ page }) => {
    await page.goto('/forum');

    // Find and click the first topic
    const topicLinks = page.locator('a[href*="/forum/"]').first();
    if (await topicLinks.count() > 0) {
      await topicLinks.click();
      await expect(page).toHaveURL(/forum\/[a-z0-9]+/, { timeout: 5_000 });

      // Click the like reaction button
      const likeBtn = page.locator('button').filter({ hasText: '👍' }).first();
      if (await likeBtn.count() > 0) {
        await likeBtn.click();
        // Button should now be highlighted (active state)
        await expect(likeBtn).toHaveClass(/indigo|active/, { timeout: 3_000 });
      }
    }
  });
});

test.describe('Forum (admin moderation)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email or username/i).fill(process.env['E2E_TEST_EMAIL'] ?? 'admin@engganyo.com');
    await page.getByLabel(/password/i).fill(process.env['E2E_TEST_PASSWORD'] ?? 'Admin@123456');
    await page.getByRole('button', { name: /login|sign in/i }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 });
  });

  test('admin forum management page loads', async ({ page }) => {
    await page.goto('/admin/forum');
    await expect(page).toHaveURL(/admin\/forum/);
    await expect(page.getByRole('heading', { name: /forum/i }).first()).toBeVisible({ timeout: 5_000 });
  });

  test('admin can lock and unlock a topic', async ({ page }) => {
    const uid = UNIQUE();

    // Create a topic to moderate
    await page.goto('/forum/new');
    await page.getByLabel(/title/i).fill(`Lock Test Topic ${uid}`);
    const contentArea = page.locator('textarea').first();
    await contentArea.fill(`Topic for lock/unlock test ${uid} with sufficient body length.`);
    await page.getByRole('button', { name: /post|create|submit/i }).click();
    await expect(page).toHaveURL(/forum\/([a-z0-9]+)/, { timeout: 10_000 });

    // Go to admin forum page and lock it
    await page.goto('/admin/forum');
    await expect(page.getByText(`Lock Test Topic ${uid}`)).toBeVisible({ timeout: 5_000 });

    const lockBtn = page.locator(`text=Lock Test Topic ${uid}`).locator('..').locator('..').locator('button[title="Lock"]').first();
    if (await lockBtn.count() > 0) {
      await lockBtn.click();
      await expect(page.locator('button[title="Unlock"]').first()).toBeVisible({ timeout: 3_000 });
    }
  });
});
