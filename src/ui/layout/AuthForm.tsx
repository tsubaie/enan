'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { request } from '@/core/http/client';
import { authCall, authClient } from '@/core/http/auth-client';
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
  email: z.string().trim().toLowerCase().pipe(z.email()),
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
  const word = useTranslations('errors');
  // ADR 0055: signing in is Better Auth's. Setup makes the administrator first, then signs in the
  // same way; recovery sets a password and sends the reader to sign in with it.
  const signIn = (values: FormValues) =>
    authCall(
      authClient.signIn.email({ email: values.email, password: values.password }),
      (code) => word(code),
    );
  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (mode !== 'login')
        await request(`/${mode}`, z.object({ data: z.json() }), {
          method: 'POST',
          body: authBody(mode, values),
        });
      if (mode !== 'recovery') await signIn(values);
    },
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
  notice = null,
}: {
  mode: Mode;
  recoveryEnabled?: boolean;
  methods?: SignInMethod[];
  notice?: 'google_failed' | 'google_unknown' | null;
}) {
  const t = useTranslations('auth');
  const c = useTranslations('common');
  const state = useAuthState(mode);
  const login = mode === 'login';
  const password = !login || methods.includes('password');
  return (
    <AuthFrame title={t(`${mode}Title`)} description={t(`${mode}Description`)}>
      {notice && <Notice notice={notice} />}
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
      {login && <LoginExtras methods={methods} recoveryEnabled={recoveryEnabled} />}
    </AuthFrame>
  );
}

function LoginExtras({
  methods,
  recoveryEnabled,
}: {
  methods: SignInMethod[];
  recoveryEnabled: boolean;
}) {
  const t = useTranslations('auth');
  return (
    <>
      <OtherMethods methods={methods} />
      {recoveryEnabled && (
        <p className="mt-5 text-center">
          <Link
            className="rounded-sm text-sm text-text-muted underline outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            href={routes.recovery()}
          >
            {t('recoverLink')}
          </Link>
        </p>
      )}
    </>
  );
}
function Notice({ notice }: { notice: 'google_failed' | 'google_unknown' }) {
  const t = useTranslations('auth');
  return (
    <p role="alert" className="mb-5 rounded-lg border border-danger/40 p-3 text-sm">
      {t(notice === 'google_unknown' ? 'googleUnknown' : 'googleFailed')}
    </p>
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
            autoCapitalize="none"
            autoCorrect="off"
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
