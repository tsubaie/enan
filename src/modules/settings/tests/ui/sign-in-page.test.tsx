// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { newClient } from '../../../../../tests/fixtures/mount';
import { SignInPage } from '../../ui/SignInPage';
import { mount } from './harness';

function show(status: object, locale: 'en' | 'ar' = 'en') {
  const client = newClient();
  client.setQueryData(['admin', 'sign-in'], { data: status });
  mount(<SignInPage />, locale, client);
}
const box = (name: string) => screen.getByRole('checkbox', { name });

it('ADMIN-B64 a method the server cannot serve says what it needs and cannot be chosen', () => {
  show({
    chosen: ['password', 'code', 'google'],
    available: { password: true, code: false, google: false, passkey: true },
    enabled: ['password'],
  });
  expect(box(en.admin.signInMethod_code).getAttribute('aria-disabled')).toBe('true');
  expect(box(en.admin.signInMethod_code).getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('link', { name: en.admin.signInNeedsMail }).getAttribute('href')).toBe(
    '/admin/mail',
  );
  // The only way in that is on cannot be switched off.
  expect(box(en.admin.signInMethod_password).getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByText(en.admin.signInLast)).toBeTruthy();
});
it('ADMIN-B64 with two methods on either can be switched off', () => {
  show(
    {
      chosen: ['password', 'code'],
      available: { password: true, code: true, google: false, passkey: true },
      enabled: ['password', 'code'],
    },
    'ar',
  );
  expect(box(ar.admin.signInMethod_password).getAttribute('aria-disabled')).toBeNull();
  expect(box(ar.admin.signInMethod_code).getAttribute('aria-checked')).toBe('true');
  expect(screen.queryByText(ar.admin.signInLast)).toBeNull();
});
const saved = {
  source: 'saved',
  clientId: '1234-abc.apps.googleusercontent.com',
  hasSecret: true,
  redirectUri: 'https://office.example.test/api/auth/callback/google',
};
function showGoogle(google: object, locale: 'en' | 'ar' = 'en') {
  const client = newClient();
  // The seeded state stands; only the save goes to the (stubbed) network.
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
  client.setQueryData(['admin', 'sign-in'], {
    data: {
      chosen: ['password', 'code', 'google'],
      available: { password: true, code: false, google: true, passkey: true },
      enabled: ['password', 'google'],
    },
  });
  client.setQueryData(['admin', 'sign-in', 'google'], { data: google });
  mount(<SignInPage />, locale, client);
}
const reply = (status: number, body: object) => vi.fn(async () => Response.json(body, { status }));
afterEach(() => vi.unstubAllGlobals());
it('ADMIN-B65 with no client the form is inline, with the redirect address to register', () => {
  showGoogle({ ...saved, source: 'none', clientId: null, hasSecret: false });
  expect(screen.getByText(en.admin.googleHelp)).toBeTruthy();
  expect(screen.getByText(saved.redirectUri).getAttribute('dir')).toBe('ltr');
  expect(screen.getByLabelText(en.admin.googleClientId)).toHaveProperty('value', '');
  expect(screen.queryByText(en.admin.googleSaved)).toBeNull();
});
it('ADMIN-B65 a saved client is a summary that never shows the secret; Edit opens the form in a dialog', () => {
  showGoogle(saved);
  expect(box(en.admin.signInMethod_google).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText(en.admin.googleSaved)).toBeTruthy();
  expect(screen.getByText(saved.clientId).getAttribute('translate')).toBe('no');
  expect(screen.getByText(saved.redirectUri)).toBeTruthy();
  expect(screen.queryByLabelText(en.admin.googleClientId)).toBeNull();
  expect(screen.getByRole('button', { name: en.admin.googleRemove })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: en.common.edit }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByLabelText(en.admin.googleClientId)).toHaveProperty(
    'value',
    saved.clientId,
  );
  expect(within(dialog).getByLabelText(en.admin.googleClientSecret)).toHaveProperty('value', '');
  expect(within(dialog).getByText(en.admin.googleSecretKept)).toBeTruthy();
  expect(document.body.textContent).not.toContain('secret-value');
});
it('ADMIN-B65 Cancel closes the dialog without saving', async () => {
  const fetch = reply(200, { data: saved });
  vi.stubGlobal('fetch', fetch);
  showGoogle(saved);
  fireEvent.click(screen.getByRole('button', { name: en.common.edit }));
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: en.common.cancel }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(fetch).not.toHaveBeenCalledWith(
    '/api/v1/admin/sign-in/google',
    expect.objectContaining({ method: 'PUT' }),
  );
});
it('ADMIN-B65 a save that fails keeps the dialog open with the error; one that succeeds closes it', async () => {
  const error = {
    code: 'validation_failed',
    message: 'Check the entered values.',
    details: {},
    requestId: 'r',
  };
  vi.stubGlobal('fetch', reply(422, { error }));
  showGoogle(saved);
  fireEvent.click(screen.getByRole('button', { name: en.common.edit }));
  const save = within(screen.getByRole('dialog')).getByRole('button', { name: en.common.save });
  fireEvent.click(save);
  expect(await within(screen.getByRole('dialog')).findByText(error.message)).toBeTruthy();
  const fetch = reply(200, { data: { ...saved, clientId: '5678-new.apps.googleusercontent.com' } });
  vi.stubGlobal('fetch', fetch);
  fireEvent.click(save);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/admin/sign-in/google',
    expect.objectContaining({ method: 'PUT' }),
  );
});
it('ADMIN-B65 a client from the environment is shown with no form, Edit or Remove, in Arabic too', () => {
  const environment = { ...saved, source: 'environment', hasSecret: true };
  for (const [locale, messages] of [
    ['en', en],
    ['ar', ar],
  ] as const) {
    showGoogle(environment, locale);
    expect(screen.getByText(messages.admin.googleFromEnv)).toBeTruthy();
    expect(screen.getByText(saved.clientId).getAttribute('dir')).toBe('ltr');
    expect(screen.getByText(saved.redirectUri)).toBeTruthy();
    expect(screen.queryByLabelText(messages.admin.googleClientId)).toBeNull();
    expect(screen.queryByRole('button', { name: messages.common.edit })).toBeNull();
    expect(screen.queryByRole('button', { name: messages.admin.googleRemove })).toBeNull();
    cleanup();
  }
});
it('ADMIN-B65 the saved summary reads in Arabic', () => {
  showGoogle(saved, 'ar');
  expect(screen.getByText(ar.admin.googleSaved)).toBeTruthy();
  expect(screen.getByRole('button', { name: ar.common.edit })).toBeTruthy();
  expect(screen.getByRole('button', { name: ar.admin.googleRemove })).toBeTruthy();
});
it('ADMIN-B76 passkeys are offered on the Sign-in page and say what they are', () => {
  show({
    chosen: ['password', 'code', 'google'],
    available: { password: true, code: true, google: true, passkey: true },
    enabled: ['password', 'code', 'google'],
  });
  const passkey = box(en.admin.signInMethod_passkey);
  expect(passkey.getAttribute('aria-checked')).toBe('false');
  expect(passkey.getAttribute('aria-disabled')).toBeNull();
  expect(screen.getByText(en.admin.signInMethodHelp_passkey)).toBeTruthy();
});
