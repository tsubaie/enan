// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AiModelPicker } from '@/modules/users/ui/AiModelPicker';
import { mount } from './harness';
// ADMIN-B27: the model selector's search, provider filter, count, empty state and clear action.
// The select is stood in by a plain one so the scenarios read the offered choices, not how the
// popover is drawn.
vi.mock('@/ui/layout/ChoiceSelect', () => ({
  ChoiceSelect: ({
    label,
    items,
    value,
    onChange,
  }: {
    label: string;
    items: { value: string; label: ReactNode }[];
    value: string;
    onChange: (value: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));
const model = (id: string, name: string) => ({
  id,
  name,
  contextLength: 200_000,
  maxOutputTokens: 8_000,
  inputPrice: 0,
  outputPrice: 0,
});
const models = [
  model('anthropic/claude-sonnet', 'Claude Sonnet'),
  model('anthropic/claude-haiku', 'Claude Haiku'),
  model('openai/gpt-mini', 'GPT Mini'),
];
function render(value = 'anthropic/claude-haiku', setValue = vi.fn()) {
  mount(<AiModelPicker models={models} value={value} setValue={setValue} label="Default model" />);
  const offered = () =>
    within(screen.getByRole('combobox', { name: 'Default model' }))
      .getAllByRole('option')
      .map((option) => option.getAttribute('value'));
  const search = (text: string) =>
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: text } });
  return { offered, search, setValue };
}

describe('ADMIN-B27 model selector', () => {
  it('ADMIN-B27 every search word must match, case-insensitively, across id and name', () => {
    const { offered, search } = render('anthropic/claude-sonnet');
    expect(screen.getByRole('status').textContent).toBe('3 of 3 eligible models match');
    search('CLAUDE son');
    expect(offered()).toEqual(['anthropic/claude-sonnet']);
    expect(screen.getByRole('status').textContent).toBe('1 of 3 eligible models match');
  });

  it('ADMIN-B27 the provider filter narrows the list and keeps the current selection offered', () => {
    const { offered } = render('anthropic/claude-haiku');
    fireEvent.change(screen.getByRole('combobox', { name: 'Model provider' }), {
      target: { value: 'openai' },
    });
    expect(offered()).toEqual(['anthropic/claude-haiku', 'openai/gpt-mini']);
    expect(screen.getByRole('status').textContent).toBe('1 of 3 eligible models match');
  });

  it('ADMIN-B27 no match shows the empty state, and Clear filters brings every model back', () => {
    const { offered, search } = render();
    search('nothing like this');
    expect(screen.getByText('No models match these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(offered()).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('ADMIN-B27 a saved model no longer offered is named and must be replaced, never chosen', () => {
    const { offered, setValue } = render('google/gone');
    expect(offered()[0]).toBe('google/gone');
    expect(screen.getByRole('alert').textContent).toContain('no longer eligible');
    const select = screen.getByRole('combobox', { name: 'Default model' });
    fireEvent.change(select, { target: { value: 'google/gone' } });
    expect(setValue).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: 'openai/gpt-mini' } });
    expect(setValue).toHaveBeenCalledWith('openai/gpt-mini');
  });
});
