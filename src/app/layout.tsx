import { type ReactNode } from 'react';
import type { Viewport } from 'next';
import { Inter, Noto_Sans_Arabic } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { Providers } from '@/ui/layout/Providers';
import { Locale } from '@/core/config/defaults';
import { workspaceWallpaper } from '@/modules/settings';
import { readerTheme } from '@/modules/account';
import { accentProperties } from '@/core/config/wallpaper-accent';
import { customFonts, fontsPath } from '@/core/files/fonts';
import '@/ui/tokens.css';
const latin = Inter({ subsets: ['latin'], variable: '--font-inter' });
// ADR 0032: two faces carry the whole interface on every device: Noto Sans Arabic for every
// Arabic character and Inter for everything else, body text and titles alike. The stacks put Inter first:
// it has no Arabic glyphs, so Arabic falls through to Noto and Latin stays in Inter.
const arabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['200', '300', '400', '500', '600', '700'],
  variable: '--font-arabic',
});
export const metadata = {
  title: 'Enan',
  description: 'Self-hosted operating surface for executive offices',
  // ADMIN-B52: iOS ignores SVG for the home-screen icon and needs an opaque PNG.
  icons: { icon: { url: '/icon.svg', type: 'image/svg+xml' }, apple: '/apple-icon.png' },
  // ADMIN-B53: the installed app draws under the status bar, as a native app does, instead of
  // under a separate black band; the header pads itself clear of it.
  appleWebApp: { title: 'Enan', statusBarStyle: 'black-translucent' },
};
// ADMIN-B53: without `cover`, iOS reports every safe-area inset as 0, so the bottom bar sat on the
// home indicator despite the env(safe-area-inset-bottom) the shell already reserves.
export const viewport: Viewport = { viewportFit: 'cover' };
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations('common');
  // ADMIN-B34: reading the nonce keeps every page dynamic, which a per-request nonce requires.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  // ADMIN-B42, ADMIN-B47: the workspace's wallpaper, drawn by tokens.css from these attributes. Its
  // accent (ADR 0037) and an uploaded image's address are workspace data, not values the stylesheet
  // can know, so they ride on <html> as custom properties that tokens.css applies per theme.
  const wallpaper = await workspaceWallpaper();
  const theme = await readerTheme();
  // ADMIN-B51: the install's own Arabic faces, only when it supplies some.
  const ownFonts = (await customFonts()).length > 0;
  const wallpaperStyle: Record<string, string> = {
    ...(wallpaper.accent ? accentProperties(wallpaper.accent) : {}),
    ...(wallpaper.image ? { '--wallpaper-image': `url('${wallpaper.image}')` } : {}),
  };
  return (
    <html
      lang={locale}
      dir={locale === Locale.options[1] ? 'rtl' : 'ltr'}
      data-wallpaper={wallpaper.name}
      data-wallpaper-tone={wallpaper.tone}
      style={wallpaperStyle} // runtime-style: the wallpaper's accent and image are workspace data
      className={`${latin.variable} ${arabic.variable}`}
      suppressHydrationWarning
    >
      <body>
        {ownFonts && <link rel="stylesheet" href={`${fontsPath}/faces.css`} precedence="default" />}
        <NextIntlClientProvider>
          <Providers nonce={nonce} theme={theme}>
            <a
              href="#content"
              className="fixed start-4 top-4 z-50 -translate-y-32 rounded-lg bg-accent px-4 py-3 text-on-accent focus:translate-y-0"
            >
              {t('skip')}
            </a>
            {children}
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
