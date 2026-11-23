// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { MarkdownField } from '@/ui/markdown/MarkdownField';
import type MarkdownEditor from '@/ui/markdown/MarkdownEditor';
import en from '@/core/i18n/messages/en.json';
import { mount } from './harness';
// The editor half loads on demand. Each scenario holds it back behind a fresh gate, so the click
// lands while it is still on its way, as it does the first time a field is entered.
const gate = vi.hoisted(() => {
  const state = { promise: Promise.resolve(), open: () => {} };
  return {
    state,
    reset() {
      state.promise = new Promise<void>((resolve) => (state.open = resolve));
    },
  };
});
vi.mock('@/ui/markdown/MarkdownEditor', async (importOriginal) => {
  const { use } = await import('react');
  const real = await importOriginal<{ default: typeof MarkdownEditor }>();
  const Real = real.default;
  return {
    default: function HeldEditor(props: ComponentProps<typeof MarkdownEditor>) {
      use(gate.state.promise);
      return <Real {...props} />;
    },
  };
});
beforeEach(() => gate.reset());
async function enterHeld() {
  const preview = screen.getByRole('button', { name: 'Content' });
  preview.focus();
  // Awaited, so React keeps the suspended entry alive and retries it when the gate opens.
  await act(async () => {
    fireEvent.click(preview);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return preview;
}
async function release() {
  await act(async () => gate.state.open());
  return screen.findByRole('textbox', { name: 'Content' });
}
describe('entering the field', () => {
  it('NOTES-A14 NOTES-B07 focus stays on the preview until the editor takes it: it never drops to the page while the editor loads', async () => {
    mount(<MarkdownField label="Content" value="## Agenda" />);
    const preview = await enterHeld();
    // A focused control that disappears drops focus to the page; a dialog around the field then
    // pulls focus onto itself a frame later and can blur the textarea that has just focused.
    expect(preview.isConnected).toBe(true);
    expect(document.activeElement).toBe(preview);
    const box = await release();
    expect(document.activeElement).toBe(box);
  });
  it('NOTES-B07 while the editor loads the preview says it is busy, with a wait cursor and a polite status, and both clear once the editor is in', async () => {
    mount(<MarkdownField label="Content" value="## Agenda" />);
    const preview = await enterHeld();
    expect(preview.getAttribute('aria-busy')).toBe('true');
    expect(preview.className).toContain('cursor-wait');
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(en.common.loading);
    await release();
    expect(document.querySelector('[aria-busy]')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('NOTES-B07 a reader who moves focus away while the editor loads keeps it there: the editor opens without taking focus', async () => {
    mount(
      <>
        <MarkdownField label="Content" value="## Agenda" />
        <button type="button">{en.common.cancel}</button>
      </>,
    );
    await enterHeld();
    const elsewhere = screen.getByRole('button', { name: en.common.cancel });
    elsewhere.focus();
    const box = await release();
    expect(document.activeElement).toBe(elsewhere);
    expect(box).not.toBe(document.activeElement);
  });
});
