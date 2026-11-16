// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import { TaskFields } from '../../ui/TaskFields';
import { mount } from './harness';
vi.mock('../../ui/queries', () => ({
  useOwners: () => ({ data: { data: [] }, isPending: false, error: null, refetch: vi.fn() }),
}));
const fields = (dueDate: string | null, save = vi.fn()) => (
  <TaskFields initial={{ title: 'Approve the budget', dueDate }} save={save} heading />
);
it('TASKS-B19 the × on a set due date clears it and returns focus to the field', async () => {
  const save = vi.fn();
  mount(fields('2026-09-12', save));
  fireEvent.click(screen.getByRole('button', { name: en.common.clearDate }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ dueDate: null }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: en.tasks.dueDate }));
  expect(screen.queryByRole('button', { name: en.common.clearDate })).toBeNull();
});
it('TASKS-B19 the date picker offers no "No date" pick', async () => {
  mount(fields('2026-09-12'));
  fireEvent.click(screen.getByRole('button', { name: en.tasks.dueDate }));
  await screen.findByRole('button', { name: en.common.tomorrow });
  expect(screen.queryByRole('button', { name: en.common.noDate })).toBeNull();
});
