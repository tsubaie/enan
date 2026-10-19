'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { request } from '@/core/http/client';
import { Locale, defaults } from '@/core/config/defaults';
import { routes } from '@/core/routes';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { NativeSelect, NativeSelectOption } from '@/ui/primitives/native-select';
import { Preferences } from './Preferences';
import { Logo } from './Logo';
import { Field } from './Field';
import { ErrorPanel } from './ErrorPanel';
const Form = z.object({
  email: z.email(),
  password: z.string().min(1).max(256),
  name: z.string(),
  workspaceName: z.string(),
  timezone: z.string(),
  locale: Locale,
  setupToken: z.string(),
  principalName: z.string(),
  token: z.string(),
});
type FormValues = z.infer<typeof Form>;
type Mode = 'setup' | 'login' | 'recovery';
const setupFields = z.enum(['name', 'workspaceName', 'timezone', 'principalName']);
function authBody(mode: Mode, values: FormValues) {
  if (mode === 'login') return { email: values.email, password: values.password };
  if (mode === 'recovery')
    return { email: values.email, password: values.password, token: values.token };
  const { token, ...setup } = values;
  void token;
  return setup;
}
function useAuthState(mode: Mode) {
  const locale = Locale.parse(useLocale());
  const client = useQueryClient();
  const form = useForm({
    resolver: zodResolver(Form),
    defaultValues: {
      email: '',
      password: '',
      name: '',
      workspaceName: defaults.workspaceName,
      timezone: defaults.timezone,
      locale,
      setupToken: '',
      principalName: '',
      token: '',
    },
  });
  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      request(mode === 'login' ? '/auth/login' : `/${mode}`, z.object({ data: z.json() }), {
        method: 'POST',
        body: authBody(mode, values),
      }),
    onSuccess: () => {
      client.clear();
      location.assign(mode === 'recovery' ? routes.login() : routes.home());
    },
  });
  return { mode, locale, form, mutation };
}
type AuthState = ReturnType<typeof useAuthState>;
export function AuthForm({
  mode,
  recoveryEnabled = false,
}: {
  mode: Mode;
  recoveryEnabled?: boolean;
}) {
  const t = useTranslations('auth');
  const c = useTranslations('common');
  const state = useAuthState(mode);
  // The sign-in pages sit on the workspace's wallpaper, with the form in one pane of the side
  // menu's frosted glass (`.auth-glass`) and the product's mark above it. The language toggle keeps
  // the top corner, so the language is chosen the same way before and after signing in.
  return (
    <div className="auth-page relative grid min-h-dvh place-items-center px-4 pt-20 pb-10 sm:py-16">
      <div className="absolute end-4 top-4 sm:end-6 sm:top-6">
        <Preferences />
      </div>
      <main id="content" className="w-full max-w-[400px]">
        <div className="auth-glass rounded-[20px] border p-6 sm:p-8">
          <AuthBrand />
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{t(`${mode}Title`)}</h1>
            <p className="mt-2 text-sm text-text-muted">{t(`${mode}Description`)}</p>
          </div>
          <form
            onSubmit={state.form.handleSubmit((values) => state.mutation.mutate(values))}
            className="grid gap-5"
          >
            {mode === 'setup' && <SetupFields state={state} />}
            {mode === 'recovery' && <RecoveryTokenField state={state} />}
            <CredentialFields state={state} />
            {state.mutation.isError && <ErrorPanel error={state.mutation.error} />}
            <Button type="submit" disabled={state.mutation.isPending}>
              {state.mutation.isPending ? c('saving') : t(mode)}
              <ArrowRight className="ms-1 size-4 rtl:rotate-180" />
            </Button>
            {mode === 'login' && recoveryEnabled && (
              <Link
                className="justify-self-center rounded-sm text-center text-sm text-text-muted underline outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                href={routes.recovery()}
              >
                {t('recoverLink')}
              </Link>
            )}
          </form>
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
function SetupFields({ state }: { state: AuthState }) {
  const t = useTranslations('auth');
  const names = new Intl.DisplayNames(state.locale, { type: 'language' });
  return (
    <>
      <Field label={t('token')} hint={t('tokenHelp')}>
        {(control) => (
          <Input autoComplete="off" required {...control} {...state.form.register('setupToken')} />
        )}
      </Field>
      {setupFields.options.map((key) => (
        <Field key={key} label={t(key)}>
          {(control) => (
            <Input required={key !== 'principalName'} {...control} {...state.form.register(key)} />
          )}
        </Field>
      ))}
      <Field label={t('language')}>
        {(control) => (
          <NativeSelect {...control} {...state.form.register('locale')}>
            {Locale.options.map((item) => (
              <NativeSelectOption key={item} value={item}>
                {names.of(item)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </Field>
    </>
  );
}
function RecoveryTokenField({ state }: { state: AuthState }) {
  const t = useTranslations('auth');
  return (
    <Field label={t('recoveryToken')}>
      {(control) => (
        <Input autoComplete="off" required {...control} {...state.form.register('token')} />
      )}
    </Field>
  );
}
function CredentialFields({ state }: { state: AuthState }) {
  const t = useTranslations('auth');
  const login = state.mode === 'login';
  const errors = state.form.formState.errors;
  return (
    <>
      <Field label={t('email')} error={errors.email?.message}>
        {(control) => (
          <Input
            type="email"
            autoComplete="username"
            required
            {...control}
            {...state.form.register('email')}
          />
        )}
      </Field>
      <Field
        label={t('password')}
        hint={login ? undefined : t('passwordHelp')}
        error={errors.password?.message}
      >
        {(control) => (
          <Input
            type="password"
            autoComplete={login ? 'current-password' : 'new-password'}
            minLength={login ? 1 : 12}
            required
            {...control}
            {...state.form.register('password')}
          />
        )}
      </Field>
    </>
  );
}
