// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/core/i18n/messages/en.json';
import { EntityGroupHeading } from '../rows';
import { testConfig, testController, testRow, type TestRow } from './fixtures';
// A card list's group heading takes the ink its group names through `groupTone` (EP-B20, ADR 0030):
// the danger ink for what is late, the accent for what is today, and plain ink otherwise.
const rows = [
  { item: testRow('a', 'Alpha', 1), leaving: false, entering: false },
  { item: testRow('b', 'Bravo', 9), leaving: false, entering: false },
];
const band = (item: TestRow) => (item.score > 5 ? 'Later' : 'Overdue');
function Heading({ toned, index }: { toned: boolean; index: number }) {
  const config = testConfig({
    group: band,
    ...(toned ? { groupTone: (item: TestRow) => (item.score > 5 ? null : 'danger') } : {}),
  });
  config.renderers.rowStyle = 'card';
  return (
    <NextIntlClientProvider
      locale="en"
      messages={en}
      formats={{ number: { integer: { maximumFractionDigits: 0 } } }}
    >
      <ul>
        <EntityGroupHeading
          config={config}
          controller={testController()}
          rows={rows}
          index={index}
        />
      </ul>
    </NextIntlClientProvider>
  );
}
describe('card group heading tone', () => {
  afterEach(cleanup);
  it('EP-B20 a card group heading is read in the ink its groupTone names', () => {
    render(<Heading toned index={0} />);
    const heading = screen.getByRole('heading', { name: /Overdue/u });
    expect(heading.className).toContain('text-danger');
    expect(heading.className).not.toContain('text-accent');
  });
  it('EP-B20 a group without a tone, or a module without groupTone, is read in plain ink', () => {
    render(<Heading toned index={1} />);
    expect(screen.getByRole('heading', { name: /Later/u }).className).toContain('text-text');
    cleanup();
    render(<Heading toned={false} index={0} />);
    const plain = screen.getByRole('heading', { name: /Overdue/u });
    expect(plain.className).toContain('text-text');
    expect(plain.className).not.toContain('text-danger');
  });
});
