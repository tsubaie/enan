'use client';
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/ui/theme/ThemeProvider';
import { ToastHost } from './toast/ToastHost';
export function Providers({
  children,
  nonce,
  theme,
}: {
  children: ReactNode;
  nonce?: string | undefined;
  // ACCT-B04: the reader's saved theme, read on the server, so no device keeps a stale choice.
  theme?: 'dark' | 'light' | undefined;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: true,
            refetchInterval: 60000,
            refetchIntervalInBackground: false,
            retry: 1,
          },
        },
      }),
  );
  return (
    // Dark until the reader chooses (ACCT-B04).
    <ThemeProvider theme={theme ?? 'dark'} nonce={nonce}>
      <QueryClientProvider client={client}>
        <ToastHost>{children}</ToastHost>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
