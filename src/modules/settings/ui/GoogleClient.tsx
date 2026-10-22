'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { GoogleStatus, type GoogleSettingsWrite } from '@/core/config/google-schema';
import { request } from '@/core/http/client';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { Field } from '@/ui/layout/Field';
import { RecordSection } from '@/ui/layout/Record';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
const response = z.object({ data: GoogleStatus });
const key = ['admin', 'sign-in', 'google'];
function useGoogle() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: () => request('/admin/sign-in/google', response),
  });
  // A saved or removed client changes which methods can be offered, so both are read again.
  const settle = () => client.invalidateQueries({ queryKey: ['admin', 'sign-in'] });
  const save = useMutation({
    mutationFn: (input: z.infer<typeof GoogleSettingsWrite>) =>
      request('/admin/sign-in/google', response, {
        method: 'PUT',
        body: { clientId: input.clientId, clientSecret: input.clientSecret ?? '' },
      }),
    gcTime: 0,
    onSuccess: settle,
  });
  const remove = useMutation({
    mutationFn: () => request('/admin/sign-in/google', response, { method: 'DELETE', body: {} }),
    onSuccess: settle,
  });
  return { query, save, remove };
}
// ADMIN-B65: the OAuth client Google sign-in uses. The redirect address is shown to copy into
// Google Cloud Console; a saved secret is never shown and is kept when the field is left empty.
export function GoogleClient() {
  const t = useTranslations('admin');
  const { query, save, remove } = useGoogle();
  if (!query.data) return query.error ? <ErrorPanel error={query.error} /> : null;
  const status = query.data.data;
  return (
    <RecordSection title={t('googleClient')}>
      <p className="px-1 text-sm leading-relaxed font-light text-text-muted">
        {status.source === 'environment' ? t('googleFromEnv') : t('googleHelp')}
      </p>
      <p className="px-1 text-sm">
        {t('googleRedirect')}{' '}
        <code
          dir="ltr"
          translate="no"
          className="break-all rounded bg-surface-raised px-1.5 py-0.5"
        >
          {status.redirectUri}
        </code>
      </p>
      <GoogleForm
        key={JSON.stringify(status)}
        status={status}
        pending={save.isPending}
        onSave={(input) => save.mutate(input)}
      />
      {save.error && <ErrorPanel error={save.error} />}
      {remove.error && <ErrorPanel error={remove.error} />}
      {status.source === 'saved' && (
        <Button
          variant="ghost"
          className="justify-self-start text-danger hover:text-danger"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          {t('googleRemove')}
        </Button>
      )}
    </RecordSection>
  );
}
function GoogleForm({
  status,
  pending,
  onSave,
}: {
  status: z.infer<typeof GoogleStatus>;
  pending: boolean;
  onSave: (input: z.infer<typeof GoogleSettingsWrite>) => void;
}) {
  const t = useTranslations('admin');
  const c = useTranslations('common');
  const [clientId, setClientId] = useState(
    status.source === 'saved' ? (status.clientId ?? '') : '',
  );
  const [clientSecret, setClientSecret] = useState('');
  return (
    <form
      className="grid gap-4 rounded-xl border bg-bg/50 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ clientId, clientSecret });
      }}
    >
      <Field label={t('googleClientId')}>
        {(control) => (
          <Input
            dir="ltr"
            required
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            {...control}
          />
        )}
      </Field>
      <Field
        label={t('googleClientSecret')}
        hint={status.source === 'saved' ? t('googleSecretKept') : undefined}
      >
        {(control) => (
          <Input
            dir="ltr"
            type="password"
            autoComplete="new-password"
            required={status.source !== 'saved'}
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            {...control}
          />
        )}
      </Field>
      <Button type="submit" className="justify-self-start" disabled={pending}>
        {pending ? c('saving') : c('save')}
      </Button>
    </form>
  );
}
