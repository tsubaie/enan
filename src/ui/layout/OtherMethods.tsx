'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { KeyRound, Mail } from 'lucide-react';
import { routes } from '@/core/routes';
import { type SignInMethod } from '@/core/config/sign-in-schema';
import { useState } from 'react';
import { Button, buttonVariants } from '@/ui/primitives/button';
import { authClient } from '@/core/http/auth-client';
import { ErrorPanel } from './ErrorPanel';
// ADMIN-B64: the login page offers each other way in the workspace has turned on, under the
// password form when there is one and in its place when there is not.
export function OtherMethods({ methods }: { methods: SignInMethod[] }) {
  const t = useTranslations('auth');
  const google = methods.includes('google');
  const code = methods.includes('code');
  const passkey = methods.includes('passkey');
  if (!google && !code && !passkey) return null;
  return (
    <div className="mt-5 grid gap-3">
      {methods.includes('password') && (
        <p className="flex items-center gap-3 text-xs text-text-muted before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
          {t('or')}
        </p>
      )}
      {passkey && <PasskeyButton />}
      {google && <GoogleButton />}
      {code && (
        <Link href={routes.loginCode()} className={buttonVariants({ variant: 'secondary' })}>
          <Mail className="me-1 size-4" aria-hidden />
          {t('codeLink')}
        </Link>
      )}
    </div>
  );
}
// ADMIN-B65: Better Auth starts the flow and sends the browser to Google; it comes back to /home,
// or to the login page with the reason when it did not finish.
function GoogleButton() {
  const t = useTranslations('auth');
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void authClient.signIn
          .social({ provider: 'google', callbackURL: routes.home(), errorCallbackURL: routes.login() })
          .finally(() => setPending(false));
      }}
    >
      {t('googleLink')}
    </Button>
  );
}
// ADMIN-B76: the browser asks for any passkey this site knows; a cancelled prompt is no failure.
function PasskeyButton() {
  const t = useTranslations('auth');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const signIn = async () => {
    setPending(true);
    setFailed(false);
    const result = await authClient.signIn.passkey();
    if (!result.error) return location.assign(routes.home());
    setPending(false);
    if (!('code' in result.error) || result.error.code !== 'AUTH_CANCELLED') setFailed(true);
  };
  return (
    <>
      <Button variant="secondary" disabled={pending} onClick={() => void signIn()}>
        <KeyRound className="me-1 size-4" aria-hidden />
        {t('passkeyLink')}
      </Button>
      {failed && <ErrorPanel error={new Error(t('passkeyFailed'))} />}
    </>
  );
}
