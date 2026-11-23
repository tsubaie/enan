// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/core/i18n/messages/en.json';
import { Providers } from '@/ui/layout/Providers';
afterEach(cleanup);
it('ACCT-B04 the theme read on the server is the one applied, whatever the browser kept', async () => {
  try {
    localStorage.setItem('theme', 'dark');
  } catch {
    // Storage may be unavailable; the theme read on the server does not depend on it.
  }
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Providers theme="light">
        <main />
      </Providers>
    </NextIntlClientProvider>,
  );
  await expect.poll(() => document.documentElement.classList.contains('light')).toBe(true);
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});
