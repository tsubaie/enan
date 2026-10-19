// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import type { z } from 'zod';
import type { AiControls as Controls } from '@/core/config/ai-controls-schema';
import { AiControls } from '@/modules/users/ui/AiControls';
import { AiConnection } from '@/modules/users/ui/AiCredentials';
import { mount } from './harness';
// ADMIN-B45: the AI page's sections. The query hooks are the seam; the switch control is stood in
// by a plain select so the scenarios read what is saved, not how a segmented control is drawn.
const state = vi.hoisted(() => ({
  controls: {} as z.infer<typeof Controls>,
  save: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/modules/users/ui/ai-queries', () => ({
  useAiControls: () => ({ isPending: false, error: null, data: { data: state.controls } }),
  useSaveAiControls: () => ({ mutate: state.save, error: null }),
  useAiCredentials: () => ({ data: { data: { provider: 'openrouter', source: 'saved' } } }),
  useSaveAiCredentials: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRemoveAiCredentials: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock('@/ui/primitives/toast', () => ({ useToastManager: () => ({ add: state.toast }) }));
vi.mock('@/ui/primitives/segmented', () => ({
  Segmented: ({
    label,
    value,
    segments,
    onChange,
  }: {
    label: string;
    value: string;
    segments: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {segments.map((segment) => (
        <option key={segment.value} value={segment.value}>
          {segment.label}
        </option>
      ))}
    </select>
  ),
}));
beforeEach(() => {
  state.save = vi.fn((_input, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
  state.toast = vi.fn();
  state.controls = {
    enabledCapabilities: ['tasks.breakdown'],
    monthlyBudgetMicros: 20000000,
    usedTokens: 1200,
    reservedTokens: 0,
    usedCostMicros: 1500000,
    reservedCostMicros: 0,
    usage: [
      {
        capability: 'notes.refine',
        calls: 4,
        inputTokens: 900,
        outputTokens: 300,
        cacheTokens: 0,
        estimatedCostMicros: 1500000,
      },
    ],
  };
});
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
describe.each(['en', 'ar'] as const)('%s', (locale) => {
  const m = locale === 'ar' ? ar : en;
  it(`ADMIN-B10 ADMIN-B45 each feature is one switch named by what it does and saves the enabled list at once ${locale}`, () => {
    mount(<AiControls />, locale);
    expect(field(m.admin.aiFeature_tasks_breakdown).value).toBe('on');
    expect(field(m.admin.aiFeature_notes_refine).value).toBe('off');
    fireEvent.change(field(m.admin.aiFeature_notes_refine), { target: { value: 'on' } });
    expect(state.save).toHaveBeenLastCalledWith(
      { enabledCapabilities: ['tasks.breakdown', 'notes.refine'], monthlyBudgetMicros: 20000000 },
      expect.anything(),
    );
    fireEvent.change(field(m.admin.aiFeature_tasks_breakdown), { target: { value: 'off' } });
    expect(state.save).toHaveBeenLastCalledWith(
      { enabledCapabilities: [], monthlyBudgetMicros: 20000000 },
      expect.anything(),
    );
    expect(state.toast).toHaveBeenCalledWith({ title: m.common.saved });
  });
  it(`ADMIN-B45 this month's usage names each feature in words, never by its capability id ${locale}`, () => {
    mount(<AiControls />, locale);
    expect(screen.getAllByText(m.admin.aiFeature_notes_refine).length).toBeGreaterThan(1);
    expect(screen.queryByText('notes.refine')).toBeNull();
  });
});
it('ADMIN-B10 ADMIN-B26 ADMIN-B45 the monthly limit is typed in dollars and saves on blur only when it changed to a positive amount or was cleared', () => {
  mount(<AiControls />);
  const limit = field(en.admin.aiLimit);
  expect(limit.value).toBe('20');
  expect(limit.placeholder).toBe(en.admin.aiNoLimit);
  expect(screen.getByText(en.admin.aiLimitUnit)).toBeTruthy();
  fireEvent.blur(limit);
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.change(limit, { target: { value: '-5' } });
  fireEvent.blur(limit);
  expect(state.save).not.toHaveBeenCalled();
  expect(limit.value).toBe('20');
  fireEvent.change(limit, { target: { value: '20.00' } });
  fireEvent.blur(limit);
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.change(limit, { target: { value: '12.5' } });
  fireEvent.blur(limit);
  expect(state.save).toHaveBeenLastCalledWith(
    { enabledCapabilities: ['tasks.breakdown'], monthlyBudgetMicros: 12500000 },
    expect.anything(),
  );
  fireEvent.change(limit, { target: { value: '' } });
  fireEvent.blur(limit);
  expect(state.save).toHaveBeenLastCalledWith(
    { enabledCapabilities: ['tasks.breakdown'], monthlyBudgetMicros: null },
    expect.anything(),
  );
});
it('ADMIN-B10 ADMIN-B26 ADMIN-B45 the month reads in dollars spent, and warns at 80% of the dollar limit counting active reservations', () => {
  mount(<AiControls />);
  expect(screen.getByText(/\$1\.50 spent · 1,200 tokens/u)).toBeTruthy();
  expect(screen.queryByText(en.admin.aiBudgetWarning)).toBeNull();
  // $14 spent plus $2 reserved is 80% of $20: the warning shows.
  state.controls = { ...state.controls, usedCostMicros: 14000000, reservedCostMicros: 2000000 };
  mount(<AiControls />);
  expect(screen.getByText(en.admin.aiBudgetWarning)).toBeTruthy();
});
it('ADMIN-B45 the Arabic page names the limit unit in dollars', () => {
  mount(<AiControls />, 'ar');
  expect(screen.getByText(ar.admin.aiLimitUnit)).toBeTruthy();
  expect(field(ar.admin.aiLimit).placeholder).toBe(ar.admin.aiNoLimit);
});
it('ADMIN-B45 an unknown capability in the usage is still shown, as its own name', () => {
  state.controls = {
    ...state.controls,
    usage: [
      {
        capability: 'future.feature',
        calls: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheTokens: 0,
        estimatedCostMicros: 0,
      },
    ],
  };
  mount(<AiControls />);
  expect(screen.getByText('future.feature')).toBeTruthy();
});
describe('ADMIN-B45 connection', () => {
  const action = { mutate: vi.fn(), isPending: false, error: null } as never;
  it.each([
    ['billing', en.admin.aiError_billing],
    ['invalid_key', en.admin.aiError_invalid_key],
    ['network', en.admin.aiError_network],
    ['rate_limit', en.admin.aiError_rate_limit],
    ['provider', en.admin.aiError_provider],
    ['something_new', en.admin.aiError_provider],
  ])('ADMIN-B45 a connection failure with code %s is explained in words', (code, words) => {
    mount(
      <AiConnection
        connection={{ state: 'disabled', checkedAt: '2026-09-10T08:00:00Z', error: code }}
        action={action}
      />,
    );
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.getByText(en.admin.aiConnectionFailed)).toBeTruthy();
    expect(screen.queryByText(code)).toBeNull();
  });
  it('ADMIN-B45 a saved key is never shown, only that one is saved, with a way to replace it', () => {
    mount(
      <AiConnection
        connection={{ state: 'enabled', checkedAt: null, error: null }}
        action={action}
      />,
    );
    expect(screen.getByText(en.admin.connected)).toBeTruthy();
    expect(screen.getByText(en.admin.aiKeyStored)).toBeTruthy();
    expect(screen.queryByLabelText(en.admin.aiKey)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.admin.aiReplace }));
    expect(field(en.admin.aiKey).type).toBe('password');
    expect(field(en.admin.aiKey).value).toBe('');
  });
});
