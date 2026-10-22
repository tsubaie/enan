'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { request } from '@/core/http/client';
import { Locale, defaults } from '@/core/config/defaults';
import { routes } from '@/core/routes';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { NativeSelect, NativeSelectOption } from '@/ui/primitives/native-select';
import { AuthFrame } from './AuthFrame';
import { OtherMethods } from './OtherMethods';
import { type SignInMethod } from '@/core/config/sign-in-schema';
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
  methods = ['password'],
}: {
  mode: Mode;
  recoveryEnabled?: boolean;
  methods?: SignInMethod[];
}) {
  const t = useTranslations('auth');
  const c = useTranslations('common');
  const state = useAuthState(mode);
  const login = mode === 'login';
  const password = !login || methods.includes('password');
  return (
    <AuthFrame title={t(`${mode}Title`)} description={t(`${mode}Description`)}>
      {password && (
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
        </form>
      )}
      {login && <OtherMethods methods={methods} />}
      {login && recoveryEnabled && (
        <p className="mt-5 text-center">
          <Link
            className="rounded-sm text-sm text-text-muted underline outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            href={routes.recovery()}
          >
            {t('recoverLink')}
          </Link>
        </p>
      )}
    </AuthFrame>
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
