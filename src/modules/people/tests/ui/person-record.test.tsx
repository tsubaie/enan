// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import en from '@/core/i18n/messages/en.json';
import { RecordTitleField } from '@/ui/layout/RecordTitleField';
// The record's tag picker reads the people tag list; the scenario controls the API's answer.
vi.mock('@/modules/people/ui/queries', () => ({
  usePersonTags: () => ({
    data: { data: [{ tag: 'Board', count: 3 }] },
    refetch: async () => undefined,
  }),
}));
const { PersonForm } = await import('@/modules/people/ui/PersonForm');
const person = {
  fullName: 'Hala Omar',
  displayName: null,
  honorific: null,
  organization: null,
  roleTitle: null,
  kind: 'external' as const,
  email: null,
  phone: null,
  notes: null,
  tags: ['finance'],
  isAssignable: false,
  userId: null,
};
afterEach(cleanup);
function mount(node: ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={en}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
describe('person record', () => {
  it('PEOPLE-B11 the kind is a segmented choice with both values on its face, and a press saves', () => {
    const save = vi.fn();
    mount(<PersonForm initial={person} save={save} />);
    const group = screen.getByRole('group', { name: en.people.kind });
    const internal = screen.getByRole('button', { name: en.common.internal });
    expect(group.contains(internal)).toBe(true);
    expect(
      screen.getByRole('button', { name: en.common.external }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(internal);
    expect(save).toHaveBeenCalledWith({ kind: 'internal' });
    expect(internal.getAttribute('aria-pressed')).toBe('true');
  });
  it('PEOPLE-B12 the record has no full-name row; the create form keeps its field', () => {
    mount(<PersonForm initial={person} save={vi.fn()} />);
    expect(screen.queryByRole('textbox', { name: en.people.fullName })).toBeNull();
    cleanup();
    mount(<PersonForm submit={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: en.people.fullName })).toBeTruthy();
  });
  it('PEOPLE-B12 the name is the heading and saves a changed name on Enter; an empty one says so', () => {
    const save = vi.fn();
    mount(
      <RecordTitleField kind="name" value="Hala Omar" label={en.people.fullName} save={save} />,
    );
    const field = screen.getByRole('textbox', { name: en.people.fullName });
    expect(field.closest('h2')).not.toBeNull();
    fireEvent.change(field, { target: { value: 'Hala Al-Omar' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.blur(field);
    expect(save).toHaveBeenCalledWith('Hala Al-Omar');
    fireEvent.change(field, { target: { value: '  ' } });
    expect(screen.getByRole('alert').textContent).toBe(en.common.nameRequired);
  });
  it('PEOPLE-B10 the tags are the shared tag field: chips that remove themselves and the people suggestions', () => {
    const save = vi.fn();
    mount(<PersonForm initial={person} save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag finance' }));
    expect(save).toHaveBeenCalledWith({ tags: [] });
    const input = screen.getByRole('combobox', { name: en.common.addTagLabel });
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Board' }));
    expect(save).toHaveBeenLastCalledWith({ tags: ['Board'] });
  });
});
