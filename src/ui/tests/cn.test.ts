import { describe, expect, it } from 'vitest';
import { cn } from '../cn';
// ADR 0030: the named type steps are sizes, so naming an ink beside one keeps both.
describe('class merging', () => {
  it('EP-B20 a named type step survives an ink class beside it', () => {
    const merged = cn('font-display text-heading', 'text-danger');
    expect(merged).toContain('text-heading');
    expect(merged).toContain('text-danger');
  });
  it('EP-B20 two type steps still collapse to the last one', () => {
    expect(cn('text-sm', 'text-title')).toBe('text-title');
  });
});
