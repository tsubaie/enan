// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Input } from '@/ui/primitives/input';
import { Textarea } from '@/ui/primitives/textarea';
import { Combobox, ComboboxContent, ComboboxSearch } from '@/ui/primitives/combobox';
const labels = { input: 'Title', textarea: 'Description', search: 'Search', pinned: 'Password' };
const text = { arabic: 'مراجعة الميزانية', english: 'Budget review' };
afterEach(cleanup);
// jsdom does not run the bidi algorithm, so these assert the attribute that hands the direction to
// the browser (docs/08 allows structural checks of `dir`): `auto` lets the typed text decide, and
// no attribute leaves an empty field in the interface's direction.
it('EP-B45 an empty field follows the interface direction', () => {
  render(<Input aria-label={labels.input} />);
  expect(screen.getByLabelText(labels.input).hasAttribute('dir')).toBe(false);
});
it('EP-B45 a single-line field takes its direction from what is typed in it, and gives it back when cleared', () => {
  render(<Input aria-label={labels.input} />);
  const field = screen.getByLabelText(labels.input);
  fireEvent.input(field, { target: { value: text.arabic } });
  expect(field.getAttribute('dir')).toBe('auto');
  fireEvent.input(field, { target: { value: '' } });
  expect(field.hasAttribute('dir')).toBe(false);
});
it('EP-B45 a field that opens with text, or whose value is set by the form, follows that text', () => {
  const { rerender } = render(
    <Input aria-label={labels.input} value="" onChange={() => undefined} />,
  );
  const field = screen.getByLabelText(labels.input);
  expect(field.hasAttribute('dir')).toBe(false);
  rerender(<Input aria-label={labels.input} value={text.english} onChange={() => undefined} />);
  expect(field.getAttribute('dir')).toBe('auto');
});
it('EP-B45 a multi-line field follows what is typed in it', () => {
  render(<Textarea aria-label={labels.textarea} defaultValue={text.arabic} />);
  const field = screen.getByLabelText(labels.textarea);
  expect(field.getAttribute('dir')).toBe('auto');
  fireEvent.input(field, { target: { value: '' } });
  expect(field.hasAttribute('dir')).toBe(false);
});
it('EP-B45 the search field inside a picker follows what is typed as well', () => {
  render(
    <Combobox open items={[]}>
      <ComboboxContent>
        <ComboboxSearch aria-label={labels.search} />
      </ComboboxContent>
    </Combobox>,
  );
  const field = screen.getByLabelText(labels.search);
  expect(field.hasAttribute('dir')).toBe(false);
  fireEvent.input(field, { target: { value: text.arabic } });
  expect(field.getAttribute('dir')).toBe('auto');
});
it('EP-B45 a field whose script is fixed keeps the direction it pins', () => {
  render(<Input aria-label={labels.pinned} dir="ltr" />);
  const field = screen.getByLabelText(labels.pinned);
  fireEvent.input(field, { target: { value: text.arabic } });
  expect(field.getAttribute('dir')).toBe('ltr');
});
