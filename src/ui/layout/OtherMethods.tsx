'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Mail } from 'lucide-react';
import { routes } from '@/core/routes';
import { type SignInMethod } from '@/core/config/sign-in-schema';
import { buttonVariants } from '@/ui/primitives/button';
// ADMIN-B64: the login page offers each other way in the workspace has turned on, under the
// password form when there is one and in its place when there is not.
export function OtherMethods({ methods }: { methods: SignInMethod[] }) {
  const t = useTranslations('auth');
  const google = methods.includes('google');
  const code = methods.includes('code');
  if (!google && !code) return null;
  return (
    <div className="mt-5 grid gap-3">
      {methods.includes('password') && (
        <p className="flex items-center gap-3 text-xs text-text-muted before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
          {t('or')}
        </p>
      )}
      {/* ADMIN-B65: a full navigation, not a client one: the server answers with a redirect to Google. */}
      {google && (
        <a href={routes.googleSignIn()} className={buttonVariants({ variant: 'secondary' })}>
          {t('googleLink')}
        </a>
      )}
      {code && (
        <Link href={routes.loginCode()} className={buttonVariants({ variant: 'secondary' })}>
          <Mail className="me-1 size-4" aria-hidden />
          {t('codeLink')}
        </Link>
      )}
    </div>
  );
}
