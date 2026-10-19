// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import en from '@/core/i18n/messages/en.json';
import { EntityCreateForm } from '../EntityCreateForm';
import { EntityActionDialog } from '../EntityActionDialog';
import { EntityBulkBar } from '../EntityBulkBar';
import type { Entity } from '../types';
// EP-B21: the two small shells every module would otherwise copy. The create form is a focusable
// heading, the last error, the module's fields, Create and Cancel; the action dialog is one small
// form in front of a selection, and closing it without submitting keeps that selection.
function mount(node: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={en}
      formats={{ number: { integer: { maximumFractionDigits: 0 } } }}
    >
      {node}
    </NextIntlClientProvider>,
  );
}
// The module's own words, as a module would hand them in from its catalog.
const copy = {
  title: 'New measure',
  field: 'Name',
  dialog: 'Add a tag',
  description: 'One tag for each',
  apply: 'Apply',
  tag: 'Tag',
};
const items: Entity[] = [
  { id: 'a', revision: 1, deletedAt: null, deletedOpId: null },
  { id: 'b', revision: 1, deletedAt: null, deletedOpId: null },
];
describe('entity shells', () => {
  afterEach(cleanup);
  it('EP-B21 the create form has a focusable heading, the last error, the fields, Create and Cancel', async () => {
    const cancel = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    mount(
      <EntityCreateForm
        title={copy.title}
        error={new Error('Name is taken')}
        pending={false}
        cancel={cancel}
        onSubmit={onSubmit}
      >
        <label>
          {copy.field}
          <input name="name" defaultValue="Throughput" />
        </label>
      </EntityCreateForm>,
    );
    const heading = screen.getByRole('heading', { name: copy.title });
    heading.focus();
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('alert').textContent).toContain('Name is taken');
    expect(screen.getByLabelText(copy.field)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.common.cancel }));
    expect(cancel).toHaveBeenCalledTimes(1);
    // The module parses the form data: the shell hands it over as posted.
    fireEvent.click(screen.getByRole('button', { name: en.common.create }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const posted = onSubmit.mock.calls[0]?.[0];
    expect(posted).toBeInstanceOf(FormData);
    expect(posted.get('name')).toBe('Throughput');
  });
  it('EP-B21 a pending create disables Create and shows no error', () => {
    mount(
      <EntityCreateForm title={copy.title} error={null} pending cancel={vi.fn()} onSubmit={vi.fn()}>
        <input name="name" />
      </EntityCreateForm>,
    );
    expect(screen.getByRole('button', { name: en.common.create }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('EP-B21 closing the action dialog without submitting keeps the selection', async () => {
    const clear = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    mount(
      <EntityBulkBar
        items={items}
        clear={clear}
        actions={[
          {
            id: 'tag',
            label: 'Add tag',
            render: (selected, finish) => (
              <EntityActionDialog
                title={copy.dialog}
                description={`${copy.description} ${selected.length}`}
                submitLabel={copy.apply}
                error={null}
                pending={false}
                finish={finish}
                onSubmit={onSubmit}
              >
                <input name="tag" aria-label={copy.tag} defaultValue="budget" />
              </EntityActionDialog>
            ),
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    const dialog = await screen.findByRole('dialog', { name: copy.dialog });
    expect(dialog.textContent).toContain(`${copy.description} 2`);
    fireEvent.click(screen.getByRole('button', { name: en.common.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    // The bar still reports the same two records as selected.
    expect(screen.getByText('2 selected')).toBeTruthy();
  });
  it('EP-B21 submitting the action dialog hands the module the form data and finish(true) clears', async () => {
    const clear = vi.fn();
    let done: (clearSelection: boolean) => void = () => undefined;
    const posted: FormData[] = [];
    const onSubmit = vi.fn(async (fields: FormData) => {
      posted.push(fields);
      done(true);
    });
    mount(
      <EntityBulkBar
        items={items}
        clear={clear}
        actions={[
          {
            id: 'tag',
            label: 'Add tag',
            render: (_selected, finish) => {
              done = finish;
              return (
                <EntityActionDialog
                  title={copy.dialog}
                  description={copy.description}
                  submitLabel={copy.apply}
                  error={new Error('Last attempt failed')}
                  pending={false}
                  finish={finish}
                  onSubmit={onSubmit}
                >
                  <input name="tag" aria-label={copy.tag} defaultValue="budget" />
                </EntityActionDialog>
              );
            },
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    const dialog = await screen.findByRole('dialog', { name: copy.dialog });
    expect(screen.getByRole('alert').textContent).toContain('Last attempt failed');
    fireEvent.click(screen.getByRole('button', { name: copy.apply }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(posted[0]?.get('tag')).toBe('budget');
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    expect(dialog.isConnected).toBe(false);
  });
});
