import type { ReactNode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider, type DateTimeFormatOptions } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import en from '../../src/core/i18n/messages/en.json';
import ar from '../../src/core/i18n/messages/ar.json';
// Component scenarios across the modules render inside the providers and the named formats the
// app configures (src/core/i18n/request.ts, Latin numerals), so a count, a percentage, a year or a
// timestamp reads in a scenario exactly as it does on the page. Queries never retry, so a missing
// network fails fast and the component shows its fallback state. The client is returned so a
// scenario can seed and inspect its cache.
const day: DateTimeFormatOptions = {
  calendar: 'gregory',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};
export const formats = {
  dateTime: {
    day,
    monthYear: { calendar: 'gregory', month: 'short', year: 'numeric' },
    month: { calendar: 'gregory', month: 'short' },
    weekday: { calendar: 'gregory', weekday: 'short' },
    dayOfMonth: { calendar: 'gregory', day: 'numeric' },
    dateTime: { ...day, hour: 'numeric', minute: '2-digit' },
  },
  number: {
    integer: { maximumFractionDigits: 0 },
    decimal: { maximumFractionDigits: 2 },
    year: { useGrouping: false, maximumFractionDigits: 0 },
    percent: { style: 'percent', maximumFractionDigits: 0 },
    signedPercent: { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' },
  },
} as const;
export function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
export function mount(node: ReactNode, locale: 'en' | 'ar' = 'en', client = newClient()) {
  cleanup();
  const result = render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'ar' ? ar : en}
      timeZone="UTC"
      now={new Date('2026-09-10T09:00:00Z')}
      formats={formats}
    >
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { ...result, client };
}
