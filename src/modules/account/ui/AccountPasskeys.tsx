'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useDateTime } from '@/ui/format';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { Field } from '@/ui/layout/Field';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/ui/primitives/dialog';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { useAddPasskey, useRemovePasskey } from './queries';
import type { Account, AccountPasskey } from '../schema/validation';
// ACCT-B10: the reader's passkeys. One can be added while the workspace has the method on (ADMIN-B76)
// and removed whenever; the server refuses removing the last way in.
export function AccountPasskeys({ account }: { account: Account }) {
  const t = useTranslations('account');
  const word = useTranslations('errors');
  const remove = useRemovePasskey((code) => word(code));
  return (
    <div className="grid min-w-0 gap-2">
      {account.passkeys.length === 0 && (
        <p className="text-sm text-text-muted">{t('passkeyNone')}</p>
      )}
      {account.passkeys.map((passkey) => (
        <PasskeyRow
          key={passkey.id}
          passkey={passkey}
          disabled={remove.isPending}
          onRemove={() => remove.mutate(passkey.id)}
        />
      ))}
      {remove.error && <ErrorPanel error={remove.error} />}
      {account.signInMethods.includes('passkey') && (
        <AddPasskey password={account.signInMethods.includes('password')} />
      )}
    </div>
  );
}
function PasskeyRow({
  passkey,
  disabled,
  onRemove,
}: {
  passkey: AccountPasskey;
  disabled: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations('account');
  const c = useTranslations('common');
  const when = useDateTime();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm">
      <bdi className="min-w-0 flex-1 truncate">{passkey.name || t('passkeyUnnamed')}</bdi>
      {passkey.backedUp && (
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
          {t('passkeySynced')}
        </span>
      )}
      <span className="text-xs text-text-muted">
        {t('passkeyAdded')} {when(passkey.createdAt)}
      </span>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => setConfirming(true)}>
        {t('passkeyRemove')}
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogTitle>{t('passkeyRemove')}</DialogTitle>
          <DialogDescription>{t('passkeyRemoveConfirm')}</DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {c('cancel')}
            </Button>
            <Button
              onClick={() => {
                setConfirming(false);
                onRemove();
              }}
            >
              {c('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
// While passwords are on, adding a passkey asks for the current one (ADMIN-B76).
function AddPasskey({ password }: { password: boolean }) {
  const t = useTranslations('account');
  const c = useTranslations('common');
  const word = useTranslations('errors');
  const add = useAddPasskey((code) => word(code));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const close = () => {
    setOpen(false);
    setName('');
    setCurrentPassword('');
    add.reset();
  };
  return (
    <div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t('passkeyAdd')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent>
          <DialogTitle>{t('passkeyAdd')}</DialogTitle>
          <DialogDescription>{t('passkeyAddHelp')}</DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              add.mutate({ name: name.trim(), currentPassword }, { onSuccess: close });
            }}
          >
            <TextField
              label={t('passkeyName')}
              placeholder={t('passkeyNamePlaceholder')}
              value={name}
              onChange={setName}
            />
            {password && (
              <TextField
                label={t('currentPassword')}
                password
                value={currentPassword}
                onChange={setCurrentPassword}
              />
            )}
            {add.error && <ErrorPanel error={add.error} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {c('cancel')}
              </Button>
              <Button type="submit" disabled={add.isPending || (password && !currentPassword)}>
                {t('passkeyAdd')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function TextField({
  label,
  placeholder,
  password = false,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  password?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      {(control) => (
        <Input
          {...control}
          {...(password
            ? { type: 'password', required: true, autoComplete: 'current-password' }
            : { maxLength: 100, placeholder })}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}
