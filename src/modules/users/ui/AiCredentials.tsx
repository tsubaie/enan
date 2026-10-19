'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { CircleCheck, CircleAlert, CircleDashed } from 'lucide-react';
import { useAiCredentials, useSaveAiCredentials, useRemoveAiCredentials } from './ai-queries';
import type { useAdminAction } from './queries';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { Property, PropertySheet } from '@/ui/layout/Property';
import { RecordSection } from '@/ui/layout/Record';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { cn } from '@/ui/cn';
// What went wrong, in words the reader can act on.
const ErrorCode = z.enum(['billing', 'invalid_key', 'network', 'provider', 'rate_limit']);
export const Connection = z.object({
  state: z.string(),
  checkedAt: z.string().nullable(),
  error: z.string().nullable(),
});
// ADMIN-B45: the AI connection in two rows: whether it works (and a way to check), and the key it
// uses. A saved key is never shown; replacing it opens one field in place.
export function AiConnection({
  connection,
  action,
}: {
  connection: z.infer<typeof Connection>;
  action: ReturnType<typeof useAdminAction>;
}) {
  const t = useTranslations('admin');
  return (
    <RecordSection title={t('aiConnection')}>
      <PropertySheet>
        <Property label={t('aiStatus')}>
          <span className="flex min-w-0 items-center gap-3">
            <StatusWord connection={connection} />
            <Button
              variant="secondary"
              size="xs"
              className="ms-auto px-3 font-light"
              disabled={action.isPending}
              onClick={() => action.mutate()}
            >
              {t('testConnection')}
            </Button>
          </span>
        </Property>
        <KeyRow />
      </PropertySheet>
      {connection.error && (
        <p className="px-1 text-sm font-light text-danger">
          {ErrorCode.safeParse(connection.error).success
            ? t(`aiError_${ErrorCode.parse(connection.error)}`)
            : t('aiError_provider')}
        </p>
      )}
      {action.error && <ErrorPanel error={action.error} />}
    </RecordSection>
  );
}
function StatusWord({ connection }: { connection: z.infer<typeof Connection> }) {
  const t = useTranslations('admin');
  const ok = connection.state === 'enabled';
  const failed = !ok && Boolean(connection.error);
  const Icon = ok ? CircleCheck : failed ? CircleAlert : CircleDashed;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm',
        ok ? 'text-success' : failed ? 'text-danger' : 'text-text-muted',
      )}
    >
      <Icon className="size-4" aria-hidden />
      {ok ? t('connected') : failed ? t('aiConnectionFailed') : t('aiNotTested')}
    </span>
  );
}
function KeyRow() {
  const t = useTranslations('admin');
  const query = useAiCredentials();
  const [editing, setEditing] = useState(false);
  const source = query.data?.data.source ?? 'none';
  return (
    <Property label={t('aiKey')}>
      {source === 'none' || editing ? (
        <KeyField onDone={() => setEditing(false)} />
      ) : (
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-light">
            {source === 'saved' ? t('aiKeyStored') : t('aiKeyFromServer')}
          </span>
          <Button
            variant="secondary"
            size="xs"
            className="ms-auto px-3 font-light"
            onClick={() => setEditing(true)}
          >
            {t('aiReplace')}
          </Button>
          {source === 'saved' && <RemoveKey />}
        </span>
      )}
    </Property>
  );
}
function RemoveKey() {
  const t = useTranslations('admin');
  const remove = useRemoveAiCredentials();
  return (
    <Button
      variant="ghost"
      size="xs"
      className="px-3 font-light text-danger hover:text-danger"
      disabled={remove.isPending}
      onClick={() => remove.mutate()}
    >
      {t('aiRemove')}
    </Button>
  );
}
function KeyField({ onDone }: { onDone: () => void }) {
  const t = useTranslations('admin');
  const c = useTranslations('common');
  const [apiKey, setApiKey] = useState('');
  const save = useSaveAiCredentials();
  return (
    <form
      className="flex min-w-0 flex-wrap items-center gap-2 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ apiKey }, { onSuccess: onDone });
      }}
    >
      <Input
        type="password"
        autoComplete="new-password"
        dir="ltr"
        aria-label={t('aiKey')}
        placeholder={t('aiKeyPlaceholder')}
        value={apiKey}
        maxLength={4096}
        className="min-w-0 flex-1"
        onChange={(event) => setApiKey(event.target.value)}
      />
      <Button type="submit" size="xs" className="px-3" disabled={save.isPending || !apiKey.trim()}>
        {c('save')}
      </Button>
      {save.error && <ErrorPanel error={save.error} />}
    </form>
  );
}
