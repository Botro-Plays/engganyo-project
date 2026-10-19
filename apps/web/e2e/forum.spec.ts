import { test, expect } from '@playwright/test';

const UNIQUE = () => Date.now().toString(36);

test.use({ storageState: 'e2e/.auth/user.json' });

async function fillNewTopicForm(page: import('@playwright/test').Page, title: string, content: string) {
  await page.goto('/forum/new');
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder(/what's your topic about/i).fill(title);
  const contentArea = page.locator('textarea').first();
  await contentArea.click();
  await contentArea.pressSequentially(content);
}

// `/forum/new` also matches a loose /forum\/[a-z0-9-]+/ pattern, so match a real topic
// detail path (/forum/<id>) explicitly and wait for the topic heading to render.
const isTopicDetailUrl = (url: URL) => /^\/forum\/(?!new$)[^/]+$/.test(url.pathname);

async function submitNewTopicAndWaitForDetail(page: import('@playwright/test').Page, title: string) {
  await page.getByRole('button', { name: /create topic/i }).click();
  await page.waitForURL(isTopicDetailUrl, { timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 10_000 });
}

test.describe('Forum (authenticated)', () => {

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
    await submitNewTopicAndWaitForDetail(page, `E2E Test Topic ${uid}`);
    await expect(page.getByText(`E2E Test Topic ${uid}`)).toBeVisible({ timeout: 5_000 });
  });

  test('can view a topic and post a reply', async ({ page }) => {
    const uid = UNIQUE();
    const replyText = `This is a test reply ${uid} with enough content to satisfy minimum length.`;

    await fillNewTopicForm(
      page,
      `Reply Test Topic ${uid}`,
      `Topic body for reply test ${uid} with enough content to pass validation checks.`,
    );
    await submitNewTopicAndWaitForDetail(page, `Reply Test Topic ${uid}`);

    await page.waitForLoadState('networkidle');
    const replyArea = page.getByPlaceholder(/write a reply/i);
    await replyArea.click();
    await replyArea.pressSequentially(replyText);
    // The topic-level "Reply" toggle also has this name; scope to the reply form's submit button.
    await page.locator('form').filter({ has: replyArea }).getByRole('button', { name: 'Reply', exact: true }).click();

    await expect(page.getByText(replyText)).toBeVisible({ timeout: 5_000 });
    await expect(replyArea).toHaveValue('');
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
    const originalTitle = `Editable Topic ${uid}`;
    const editedTitle = `Edited Topic ${uid}`;
    const editedContent = `Edited content for edit test ${uid} with enough body text here.`;

    await fillNewTopicForm(
      page,
      originalTitle,
      `Original content for edit test ${uid} with enough body text here.`,
    );
    await submitNewTopicAndWaitForDetail(page, originalTitle);
    await page.waitForLoadState('networkidle');

    // Author-only control: an icon-only button named by its title attribute.
    await page.getByRole('button', { name: 'Edit topic' }).click();

    // The edit-mode inputs have no label/placeholder, so scope to the card that holds Save.
    const saveButton = page.getByRole('button', { name: 'Save', exact: true });
    const topicCard = page.locator('div.card-glass').filter({ has: saveButton });
    await topicCard.locator('input').fill(editedTitle);
    await topicCard.locator('textarea').fill(editedContent);
    await saveButton.click();

    const assertEdited = async () => {
      await expect(page.getByRole('heading', { level: 1, name: editedTitle })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(editedContent)).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: originalTitle })).toHaveCount(0);
    };
    await assertEdited();

    // Persisted server-side, not just local UI state.
    await page.reload();
    await assertEdited();
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
  test('admin without 2FA is redirected to security settings', async ({ page }) => {
    await page.goto('/admin/forum');
    await expect(page).toHaveURL(/settings\/security/);
    await expect(page.getByText(/admin access requires 2fa/i)).toBeVisible({ timeout: 5_000 });
  });

  test('admin without 2FA cannot access admin panel via direct link', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/settings\/security/);
  });
});
