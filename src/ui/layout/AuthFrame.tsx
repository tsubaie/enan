'use client';
import { type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { routes } from '@/core/routes';
import { Preferences } from './Preferences';
import { Logo } from './Logo';
// The sign-in pages sit on the workspace's wallpaper, with the form in one pane of the side
// menu's frosted glass (`.auth-glass`) and the product's mark above it. The language toggle keeps
// the top corner, so the language is chosen the same way before and after signing in.
export function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const t = useTranslations('auth');
  return (
    <div className="auth-page relative grid min-h-dvh place-items-center px-4 pt-[calc(env(safe-area-inset-top)+5rem)] pb-[calc(env(safe-area-inset-bottom)+2.5rem)] sm:py-16">
      <div className="absolute end-4 top-[calc(env(safe-area-inset-top)+1rem)] sm:end-6 sm:top-[calc(env(safe-area-inset-top)+1.5rem)]">
        <Preferences />
      </div>
      <main id="content" className="w-full max-w-[400px]">
        <div className="auth-glass rounded-[20px] border p-6 sm:p-8">
          <AuthBrand />
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm text-text-muted">{description}</p>
          </div>
          {children}
          <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-text-muted">
            <ShieldCheck className="size-4 shrink-0" />
            {t('secure')}
          </p>
        </div>
      </main>
    </div>
  );
}
// The product's mark in its accent tile, as the side menu draws the workspace's, with the
// product's name beside it: before signing in there is no workspace to name yet.
function AuthBrand() {
  const c = useTranslations('common');
  return (
    <Link
      href={routes.root()}
      className="mb-7 flex w-fit items-center gap-3 rounded-lg font-display text-brand outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent ring-1 ring-accent/25 ring-inset">
        <Logo className="size-[22px]" />
      </span>
      <span className="grid">
        <span className="font-semibold">{c('brand')}</span>
        <span className="text-xs font-normal text-text-muted">{c('tagline')}</span>
      </span>
    </Link>
  );
}
