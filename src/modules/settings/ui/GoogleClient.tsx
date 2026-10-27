'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { GoogleStatus, type GoogleSettingsWrite } from '@/core/config/google-schema';
import { request } from '@/core/http/client';
import { CircleCheck } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Dialog, DialogContent, DialogTitle } from '@/ui/primitives/dialog';
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
type Status = z.infer<typeof GoogleStatus>;
type Google = ReturnType<typeof useGoogle>;
// ADMIN-B65: the OAuth client Google sign-in uses. The redirect address is shown to copy into
// Google Cloud Console; a saved secret is never shown and is kept when the field is left empty.
// A saved client is summarised and edited in a dialog; one from the environment is only shown.
export function GoogleClient() {
  const t = useTranslations('admin');
  const google = useGoogle();
  const { query, save } = google;
  if (!query.data) return query.error ? <ErrorPanel error={query.error} /> : null;
  const status = query.data.data;
  return (
    <RecordSection title={t('googleClient')}>
      {status.source === 'none' && (
        <>
          <p className="px-1 text-sm leading-relaxed font-light text-text-muted">
            {t('googleHelp')}
          </p>
          <Redirect uri={status.redirectUri} />
          <GoogleForm
            status={status}
            pending={save.isPending}
            onSave={(input) => save.mutate(input)}
          />
          {save.error && <ErrorPanel error={save.error} />}
        </>
      )}
      {status.source === 'saved' && <SavedGoogle status={status} google={google} />}
      {status.source === 'environment' && (
        <>
          <p className="px-1 text-sm leading-relaxed font-light text-text-muted">
            {t('googleFromEnv')}
          </p>
          {status.clientId && <ClientId value={status.clientId} />}
          <Redirect uri={status.redirectUri} />
        </>
      )}
    </RecordSection>
  );
}
function Redirect({ uri }: { uri: string }) {
  const t = useTranslations('admin');
  return (
    <p className="px-1 text-sm">
      {t('googleRedirect')}{' '}
      <span dir="ltr" translate="no" className="font-mono break-all text-text">
        {uri}
      </span>
    </p>
  );
}
function ClientId({ value }: { value: string }) {
  return (
    <span dir="ltr" translate="no" className="px-1 font-mono text-xs break-all text-text-muted">
      {value}
    </span>
  );
}
function SavedGoogle({ status, google }: { status: Status; google: Google }) {
  const t = useTranslations('admin');
  const c = useTranslations('common');
  const [editing, setEditing] = useState(false);
  const { save, remove } = google;
  return (
    <div className="grid gap-3 rounded-xl border bg-bg/50 p-4">
      <p className="flex items-center gap-2 text-sm">
        <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
        {t('googleSaved')}
      </p>
      {status.clientId && <ClientId value={status.clientId} />}
      <Redirect uri={status.redirectUri} />
      {remove.error && <ErrorPanel error={remove.error} />}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          {c('edit')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-danger hover:text-danger"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          {t('googleRemove')}
        </Button>
      </div>
      <Dialog
        open={editing}
        onOpenChange={(open) => {
          setEditing(open);
          if (!open) save.reset();
        }}
      >
        <DialogContent>
          <DialogTitle>{t('googleClient')}</DialogTitle>
          <GoogleForm
            status={status}
            pending={save.isPending}
            onCancel={() => setEditing(false)}
            onSave={(input) => save.mutate(input, { onSuccess: () => setEditing(false) })}
          />
          {save.error && <ErrorPanel error={save.error} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function GoogleForm({
  status,
  pending,
  onSave,
  onCancel,
}: {
  status: Status;
  pending: boolean;
  onSave: (input: z.infer<typeof GoogleSettingsWrite>) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('admin');
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
      <FormActions pending={pending} onCancel={onCancel} />
    </form>
  );
}
function FormActions({
  pending,
  onCancel,
}: {
  pending: boolean;
  onCancel?: (() => void) | undefined;
}) {
  const c = useTranslations('common');
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={pending}>
        {pending ? c('saving') : c('save')}
      </Button>
      {onCancel && (
        <Button type="button" variant="outline" onClick={onCancel}>
          {c('cancel')}
        </Button>
      )}
    </div>
  );
}
