'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { authCall, authClient } from '@/core/http/auth-client';
import { routes } from '@/core/routes';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { AuthFrame } from './AuthFrame';
import { Field } from './Field';
import { ErrorPanel } from './ErrorPanel';
// ADMIN-B63: sign in with a code sent by email. The first step always says the same thing,
// because the server answers the same whether or not the address has an account.
export function CodeSignIn({ passwordEnabled }: { passwordEnabled: boolean }) {
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const word = useTranslations('errors');
  const send = useMutation({
    mutationFn: (address: string) =>
      authCall(
        authClient.emailOtp.sendVerificationOtp({ email: address, type: 'sign-in' }),
        (code) => word(code),
      ),
    onSuccess: (_, address) => setSentTo(address),
  });
  return (
    <AuthFrame title={t('codeTitle')} description={t('codeDescription')}>
      {sentTo === null ? (
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            send.mutate(email.trim().toLowerCase());
          }}
        >
          <Field label={t('email')}>
            {(control) => (
              <Input
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                {...control}
              />
            )}
          </Field>
          {send.isError && <ErrorPanel error={send.error} />}
          <Button type="submit" disabled={send.isPending}>
            {t('codeSend')}
            <ArrowRight className="ms-1 size-4 rtl:rotate-180" />
          </Button>
        </form>
      ) : (
        <CodeEntry email={sentTo} onRestart={() => setSentTo(null)} />
      )}
      {passwordEnabled && (
        <p className="mt-5 text-center">
          <Link
            className="rounded-sm text-sm text-text-muted underline outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            href={routes.login()}
          >
            {t('passwordLink')}
          </Link>
        </p>
      )}
    </AuthFrame>
  );
}
function CodeEntry({ email, onRestart }: { email: string; onRestart: () => void }) {
  const t = useTranslations('auth');
  const client = useQueryClient();
  const [code, setCode] = useState('');
  const word = useTranslations('errors');
  const verify = useMutation({
    mutationFn: () =>
      authCall(authClient.signIn.emailOtp({ email, otp: code }), (failure) => word(failure)),
    onSuccess: () => {
      client.clear();
      location.assign(routes.home());
    },
  });
  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        verify.mutate();
      }}
    >
      <p role="status" className="text-sm text-text-muted">
        {t('codeSent', { email })}
      </p>
      <Field label={t('code')}>
        {(control) => (
          <Input
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/gu, ''))}
            {...control}
          />
        )}
      </Field>
      {verify.isError && <ErrorPanel error={verify.error} />}
      <Button type="submit" disabled={verify.isPending || code.length !== 6}>
        {t('login')}
        <ArrowRight className="ms-1 size-4 rtl:rotate-180" />
      </Button>
      <Button type="button" variant="ghost" onClick={onRestart}>
        {t('codeAgain')}
      </Button>
    </form>
  );
}
