'use client';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CircleCheck, CircleDashed } from 'lucide-react';
import { MailFailure, MailSettingsWrite, type MailStatus } from '@/core/config/mail-schema';
import { ApiError } from '@/core/http/client';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { Field } from '@/ui/layout/Field';
import { Property, PropertySheet } from '@/ui/layout/Property';
import { RecordSection } from '@/ui/layout/Record';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import Loading from '@/ui/layout/Loading';
import { cn } from '@/ui/cn';
import { useMailStatus, useRemoveMail, useSaveMail, useTestMail } from './mail-queries';
type Status = z.infer<typeof MailStatus>;
// ADMIN-B60/B61: whether Enan can send mail, a test message to prove it, and the server it uses.
export function MailPage() {
  const query = useMailStatus();
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorPanel error={query.error} retry={() => void query.refetch()} />;
  const status = query.data.data;
  return (
    <div>
      <MailState status={status} />
      <MailServerForm key={JSON.stringify(status)} status={status} />
    </div>
  );
}
const sourceKey: Record<Status['source'], 'mailSaved' | 'mailFromServer' | 'mailNotSetUp'> = {
  saved: 'mailSaved',
  environment: 'mailFromServer',
  none: 'mailNotSetUp',
};
function MailState({ status }: { status: Status }) {
  const t = useTranslations('admin');
  const send = useTestMail();
  const ready = status.source !== 'none';
  const Icon = ready ? CircleCheck : CircleDashed;
  return (
    <RecordSection title={t('mailStatus')}>
      <PropertySheet>
        <Property label={t('mailStatusLabel')}>
          <span className="flex min-w-0 items-center gap-3">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-sm',
                ready ? 'text-success' : 'text-text-muted',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t(sourceKey[status.source])}
            </span>
            <Button
              variant="secondary"
              size="xs"
              className="ms-auto px-3 font-light"
              disabled={!ready || send.isPending}
              onClick={() => send.mutate()}
            >
              {send.isPending ? t('mailSending') : t('mailSendTest')}
            </Button>
          </span>
        </Property>
      </PropertySheet>
      {send.data && (
        <p role="status" className="px-1 text-sm font-light text-success">
          {t('mailTestSent', { to: send.data.data.to })}
        </p>
      )}
      {send.error && <SendError error={send.error} />}
    </RecordSection>
  );
}
const Failed = z.object({ reason: MailFailure });
function SendError({ error }: { error: Error }) {
  const t = useTranslations('admin');
  const failed = error instanceof ApiError ? Failed.safeParse(error.details) : null;
  if (!failed?.success) return <ErrorPanel error={error} />;
  return (
    <p role="alert" className="px-1 text-sm font-light text-danger">
      {t(`mailError_${failed.data.reason}`)}
    </p>
  );
}
function MailServerForm({ status }: { status: Status }) {
  const t = useTranslations('admin');
  const c = useTranslations('common');
  const save = useSaveMail();
  const remove = useRemoveMail();
  const form = useMailForm(status);
  return (
    <RecordSection title={t('mailServer')}>
      <p className="px-1 text-sm leading-relaxed font-light text-text-muted">
        {status.source === 'environment' ? t('mailServerFromEnv') : t('mailServerHelp')}
      </p>
      <form
        className="grid gap-4 rounded-xl border bg-bg/50 p-4"
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        <MailFields form={form} hasPassword={status.hasPassword} />
        {save.error && <ErrorPanel error={save.error} />}
        {remove.error && <ErrorPanel error={remove.error} />}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? c('saving') : c('save')}
          </Button>
          {status.source === 'saved' && (
            <Button
              type="button"
              variant="ghost"
              className="text-danger hover:text-danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t('mailRemove')}
            </Button>
          )}
          {save.isSuccess && (
            <p role="status" className="text-sm font-light text-success">
              {c('saved')}
            </p>
          )}
        </div>
      </form>
    </RecordSection>
  );
}
function useMailForm(status: Status) {
  return useForm({
    resolver: zodResolver(MailSettingsWrite),
    defaultValues: {
      host: status.host ?? '',
      port: status.port ?? 587,
      username: status.username ?? '',
      password: '',
      fromAddress: status.fromAddress ?? '',
    },
  });
}
function MailFields({
  form,
  hasPassword,
}: {
  form: ReturnType<typeof useMailForm>;
  hasPassword: boolean;
}) {
  const t = useTranslations('admin');
  const errors = form.formState.errors;
  return (
    <>
      <Field label={t('mailHost')} error={errors.host ? t('mailHostInvalid') : undefined}>
        {(control) => <Input dir="ltr" required {...control} {...form.register('host')} />}
      </Field>
      <Field label={t('mailPort')} hint={t('mailPortHint')}>
        {(control) => (
          <Input
            dir="ltr"
            type="number"
            required
            {...control}
            {...form.register('port', { valueAsNumber: true })}
          />
        )}
      </Field>
      <Field label={t('mailUsername')}>
        {(control) => (
          <Input dir="ltr" autoComplete="off" {...control} {...form.register('username')} />
        )}
      </Field>
      <Field label={t('mailPassword')} hint={hasPassword ? t('mailPasswordKept') : undefined}>
        {(control) => (
          <Input
            dir="ltr"
            type="password"
            autoComplete="new-password"
            {...control}
            {...form.register('password')}
          />
        )}
      </Field>
      <Field label={t('mailFrom')} error={errors.fromAddress ? t('mailFromInvalid') : undefined}>
        {(control) => (
          <Input dir="ltr" type="email" required {...control} {...form.register('fromAddress')} />
        )}
      </Field>
    </>
  );
}
