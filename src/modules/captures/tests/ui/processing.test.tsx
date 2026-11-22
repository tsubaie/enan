// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import { CaptureProcessing, type Stage } from '../../ui/CaptureProcessing';
import { mount } from '../../../../../tests/fixtures/mount';
// CAPTURES-B01: the recorder form that held focus unmounts on Stop, so the panel after it hands
// focus to its primary action (WCAG 2.4.3) instead of dropping it on the page.
const panel = (stage: Stage) => (
  <CaptureProcessing
    placement="desktop-floating"
    stage={stage}
    capture={undefined}
    seconds={12}
    done={() => {}}
    retry={() => {}}
  />
);
it.each([
  ['uploading', 'button', en.captures.done],
  ['offline', 'button', en.captures.retry],
  ['ready', 'link', en.captures.reviewNow],
] as const)(
  'CAPTURES-B01 after Stop the %s panel focuses its primary action',
  (stage, role, name) => {
    mount(panel(stage));
    expect(document.activeElement).toBe(screen.getByRole(role, { name }));
  },
);
it('CAPTURES-B01 the panel does not take focus the reader has moved elsewhere', () => {
  mount(
    <>
      <input aria-label={en.common.search} ref={(node) => node?.focus()} />
      {panel('ready')}
    </>,
  );
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: en.common.search }));
});
