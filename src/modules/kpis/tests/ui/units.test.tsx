// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { AmountInput } from '../../ui/KpiPickers';
import { useKpiLabels } from '../../ui/use-kpi-labels';
import type { Unit } from '../../schema/validation';
import { mount } from './harness';
const field = 'Value';
// KPIS-B28: a value carries its unit wherever it is read or typed.
function Value({ amount, unit }: { amount: number; unit: Unit }) {
  return <output>{useKpiLabels().value(amount, unit)}</output>;
}
describe.each(['en', 'ar'] as const)('%s', (locale) => {
  it(`KPIS-B28 a percentage field shows the % mark after the digits and reads left to right ${locale}`, () => {
    const { container } = mount(<AmountInput unit="percent" aria-label={field} />, locale);
    const input = screen.getByLabelText(field);
    expect(input.getAttribute('dir')).toBe('ltr');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.parentElement?.getAttribute('dir')).toBe('ltr');
    const mark = container.querySelector('[aria-hidden="true"]');
    expect(mark?.textContent).toContain('%');
  });
  it(`KPIS-B28 a plain count field has no unit mark ${locale}`, () => {
    const { container } = mount(<AmountInput unit="count" aria-label={field} />, locale);
    expect(screen.getByLabelText(field).getAttribute('dir')).toBe('ltr');
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
  it(`KPIS-B28 a percentage value reads with its % sign ${locale}`, () => {
    mount(<Value amount={55} unit="percent" />, locale);
    expect(screen.getByRole('status').textContent).toContain('55%');
    mount(<Value amount={12} unit="count" />, locale);
    expect(screen.getByRole('status').textContent).toBe('12');
  });
});
