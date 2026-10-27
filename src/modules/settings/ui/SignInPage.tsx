'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  SignInMethodsStatus,
  type SignInMethod,
  type SignInMethodsWrite,
} from '@/core/config/sign-in-schema';
import { request } from '@/core/http/client';
import { routes } from '@/core/routes';
import { Checkbox } from '@/ui/primitives/checkbox';
import { PropertySheet } from '@/ui/layout/Property';
import { RecordSection } from '@/ui/layout/Record';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import Loading from '@/ui/layout/Loading';
import { GoogleClient } from './GoogleClient';
const response = z.object({ data: SignInMethodsStatus });
type Status = z.infer<typeof SignInMethodsStatus>;
// The methods this version can offer, in the order the login page shows them.
const offered: SignInMethod[] = ['password', 'code', 'google', 'passkey'];
// ADMIN-B64: which ways in the login page offers. A method the server cannot serve yet says what it
// needs; the last one switched on cannot be switched off. Every change saves at once.
export function SignInPage() {
  const t = useTranslations('admin');
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['admin', 'sign-in'],
    queryFn: () => request('/admin/sign-in', response),
  });
  const save = useMutation({
    mutationFn: (input: z.infer<typeof SignInMethodsWrite>) =>
      request('/admin/sign-in', response, { method: 'PUT', body: input }),
    onSuccess: (data) => client.setQueryData(['admin', 'sign-in'], data),
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorPanel error={query.error} retry={() => void query.refetch()} />;
  const status = query.data.data;
  const toggle = (method: SignInMethod, on: boolean) =>
    save.mutate({
      methods: on
        ? [...status.chosen, method]
        : status.chosen.filter((chosen) => chosen !== method),
    });
  return (
    <>
      <RecordSection title={t('signInMethods')}>
        <p className="px-1 text-sm leading-relaxed font-light text-text-muted">
          {t('signInMethodsHelp')}
        </p>
        <PropertySheet>
          {offered.map((method) => (
            <MethodRow
              key={method}
              method={method}
              status={status}
              disabled={save.isPending}
              onChange={(on) => toggle(method, on)}
            />
          ))}
        </PropertySheet>
        {save.error && <ErrorPanel error={save.error} />}
        {save.isSuccess && (
          <p role="status" className="px-1 text-sm font-light text-success">
            {t('signInSaved')}
          </p>
        )}
      </RecordSection>
      <GoogleClient />
    </>
  );
}
function MethodRow({
  method,
  status,
  disabled,
  onChange,
}: {
  method: SignInMethod;
  status: Status;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useTranslations('admin');
  const chosen = status.chosen.includes(method);
  const available = status.available[method];
  const last = chosen && status.enabled.length === 1 && status.enabled.includes(method);
  return (
    <div className="grid gap-1 px-3 py-3 text-sm">
      <label className="flex items-center gap-3">
        <Checkbox
          checked={chosen && available}
          disabled={disabled || !available || last}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
        <span className="font-medium">{t(`signInMethod_${method}`)}</span>
      </label>
      <p className="ps-7 text-xs font-light text-text-muted">
        {!available && method === 'google' ? (
          t('signInNeedsGoogle')
        ) : !available ? (
          <Link className="underline" href={routes.admin('mail')}>
            {t('signInNeedsMail')}
          </Link>
        ) : last ? (
          t('signInLast')
        ) : (
          t(`signInMethodHelp_${method}`)
        )}
      </p>
      <PasskeyAccountLink method={method} status={status} />
    </div>
  );
}
// ADMIN-B76: switching passkeys on does not give the administrator one; point them to where they add it.
function PasskeyAccountLink({ method, status }: { method: SignInMethod; status: Status }) {
  const t = useTranslations('admin');
  if (method !== 'passkey' || !status.chosen.includes(method) || !status.available[method]) {
    return null;
  }
  return (
    <p className="ps-7 pt-1.5 text-sm text-text-muted">
      {t('signInPasskeyAccountHint')}{' '}
      <Link
        href={routes.accountPasskeys()}
        className="font-medium text-accent underline underline-offset-4"
      >
        {t('signInPasskeyAccountLink')}
      </Link>
    </p>
  );
}
