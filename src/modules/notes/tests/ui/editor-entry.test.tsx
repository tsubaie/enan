// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { MarkdownField } from '@/ui/markdown/MarkdownField';
import { mount } from './harness';
// The editor half loads on demand; the gate holds its module back so the click lands while it is
// still on its way, as it does the first time a field is entered.
const gate = vi.hoisted(() => {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open: () => open() };
});
vi.mock('@/ui/markdown/MarkdownEditor', async (importOriginal) => {
  await gate.opened;
  return importOriginal();
});
describe('entering the field', () => {
  it('NOTES-A14 NOTES-B07 focus stays on the preview until the editor takes it: it never drops to the page while the editor loads', async () => {
    mount(<MarkdownField label="Content" value="## Agenda" />);
    const preview = screen.getByRole('button', { name: 'Content' });
    preview.focus();
    fireEvent.click(preview);
    // A focused control that disappears drops focus to the page; a dialog around the field then
    // pulls focus onto itself a frame later and can blur the textarea that has just focused.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(preview.isConnected).toBe(true);
    expect(document.activeElement).toBe(preview);
    gate.open();
    const box = await screen.findByRole('textbox', { name: 'Content' });
    expect(document.activeElement).toBe(box);
  });
});
