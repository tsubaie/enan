import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { loginAs } from './fixtures/auth';
import { findRow, selectView } from './fixtures/views';
import { fill } from './fixtures/messages';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
import ar from '../src/core/i18n/messages/ar.json' with { type: 'json' };
type Reply = {
  status: number;
  body: { data?: { id: string; revision: number; title?: string; ownerName?: string | null } };
};
// Writes a unit scenario already covers go through the API, so the browser scenario spends its
// time on what it is about: whether the person's page shows the work assigned to them.
async function api(page: Page, path: string, method = 'GET', body?: object): Promise<Reply> {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'ExecutiveOS',
          'Idempotency-Key': crypto.randomUUID(),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: response.status,
        body: response.status === 204 ? {} : await response.json(),
      };
    },
    { path, method, body },
  );
}
async function trash(page: Page, path: string) {
  const current = await api(page, path);
  if (current.status === 200 && current.body.data)
    await api(page, path, 'DELETE', { revision: current.body.data.revision });
}
for (const locale of ['en', 'ar']) {
  const m = locale === 'ar' ? ar : en;
  test(`PEOPLE-A01 PEOPLE-B01 PEOPLE-B03 PEOPLE-I03 an assignable person becomes a task owner and their page lists the task ${locale}`, async ({
    page,
  }) => {
    await loginAs(page, locale);
    await page.goto('/people');
    await expect(page.getByRole('heading', { name: m.common.people, exact: true })).toBeVisible();
    const name = `${locale === 'ar' ? 'مسند' : 'Assignee'} ${crypto.randomUUID()}`;
    await page.getByRole('button', { name: m.common.create, exact: true }).click();
    await page.getByLabel(m.people.fullName, { exact: true }).fill(name);
    // On a phone the form is a sheet that slides up, and on a busy machine a tap during the slide
    // can land beside the box; it is ticked until it reads as ticked before the form is sent.
    const assignable = page.getByRole('checkbox', { name: m.people.isAssignable });
    await expect(async () => {
      if ((await assignable.getAttribute('aria-checked')) !== 'true') await assignable.click();
      await expect(assignable).toBeChecked({ timeout: 1_000 });
    }).toPass();
    await page.getByRole('button', { name: m.common.create, exact: true }).last().click();
    await expect(page).toHaveURL(/id=/);
    const personId = new URL(page.url()).searchParams.get('id') ?? '';
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: m.people.isAssignable })).toBeChecked();
    const title = `${locale === 'ar' ? 'مراجعة' : 'Review'} ${crypto.randomUUID()}`;
    try {
      // Owner pickers read the assignable view; the new person is in it, and in the directory's
      // Assignable view, before any task names them.
      const owners = await page.evaluate(
        async (q) =>
          (await (await fetch(`/api/v1/people?view=assignable&q=${encodeURIComponent(q)}`)).json())
            .data as { id: string }[],
        name,
      );
      expect(owners.map((owner) => owner.id)).toEqual([personId]);
      await page
        .getByRole('button', { name: new RegExp(`^(${m.common.close}|${m.common.back})$`, 'u') })
        .first()
        .click();
      await expect(page).not.toHaveURL(/id=/);
      await selectView(page, locale, new RegExp(`^${m.common.assignable}`, 'u'));
      await expect(await findRow(page, m.people.searchList, name)).toBeVisible();
      // Assigning them a task puts it on their page, where it opens inside their own task list.
      const created = await api(page, '/tasks', 'POST', {
        title,
        ownerId: personId,
        status: 'next_action',
      });
      expect(created.status).toBe(201);
      expect(created.body.data?.ownerName).toBe(name);
      const taskId = created.body.data?.id ?? '';
      await page.goto(`/people?view=all&id=${personId}`);
      await expect(
        page.getByRole('heading', { name: m.tasks.assignedTasks, exact: true }),
      ).toBeVisible();
      const link = page.getByRole('link', { name: title, exact: true });
      await expect(link).toBeVisible();
      await expect(
        page.getByRole('link', { name: fill(m.tasks.viewAssigned, { count: 1 }), exact: true }),
      ).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/tasks\\?.*ownerId=${personId}`, 'u'));
      await expect(page).toHaveURL(new RegExp(`id=${taskId}`, 'u'));
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      // The task side agrees: its owner control reads the person's name.
      await expect(page.getByLabel(m.tasks.owner, { exact: true }).last()).toContainText(name);
      // A person who is no longer assignable leaves the picker but keeps the task (PEOPLE-I03).
      const person = await api(page, `/people/${personId}`);
      const off = await api(page, `/people/${personId}`, 'PATCH', {
        revision: person.body.data?.revision,
        isAssignable: false,
      });
      expect(off.status).toBe(200);
      const after = await page.evaluate(
        async (q) =>
          (await (await fetch(`/api/v1/people?view=assignable&q=${encodeURIComponent(q)}`)).json())
            .data as { id: string }[],
        name,
      );
      expect(after).toEqual([]);
      await page.goto(`/people?view=all&id=${personId}`);
      await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
    } finally {
      // Leave nothing behind: accumulated people would push other scenarios' records past the
      // first page, and an assignable leftover would surface in every owner picker.
      const tasks = await page.evaluate(
        async (ownerId) =>
          (await (await fetch(`/api/v1/tasks?view=all&ownerId=${ownerId}`)).json()).data as {
            id: string;
          }[],
        personId,
      );
      for (const task of tasks) await trash(page, `/tasks/${task.id}`);
      await trash(page, `/people/${personId}`);
    }
  });
}
