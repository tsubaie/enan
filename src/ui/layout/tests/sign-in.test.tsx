// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { AuthForm } from '../AuthForm';
import { CodeSignIn } from '../CodeSignIn';
import { mount } from '../../../../tests/fixtures/mount';

const http = vi.hoisted(() => ({ request: vi.fn(), social: vi.fn(), passkey: vi.fn() }));
vi.mock('@/core/http/auth-client', async (original) => ({
  ...(await original<typeof import('@/core/http/auth-client')>()),
  authClient: {
    emailOtp: { sendVerificationOtp: http.request },
    signIn: { social: http.social, emailOtp: vi.fn(), email: vi.fn(), passkey: http.passkey },
  },
}));
vi.mock('../Preferences', () => ({ Preferences: () => null }));
afterEach(() => {
  http.request.mockReset();
  http.social.mockReset();
  http.passkey.mockReset();
});

it('ADMIN-B64 the login page offers the password form and, when on, an emailed code', () => {
  mount(<AuthForm mode="login" methods={['password', 'code']} />);
  expect(screen.getByLabelText(en.auth.password)).toBeTruthy();
  expect(screen.getByRole('link', { name: en.auth.codeLink }).getAttribute('href')).toBe(
    '/login/code',
  );
  mount(<AuthForm mode="login" methods={['password']} />);
  expect(screen.queryByRole('link', { name: en.auth.codeLink })).toBeNull();
});
it('ADMIN-B64 with password sign-in off the login page has no password form', () => {
  mount(<AuthForm mode="login" methods={['code']} />, 'ar');
  expect(screen.queryByLabelText(ar.auth.password)).toBeNull();
  expect(screen.getByRole('link', { name: ar.auth.codeLink })).toBeTruthy();
});
it('ADMIN-B63 the code form asks for the email, then for the six digits it says may be on their way', async () => {
  http.request.mockResolvedValue({ data: { success: true }, error: null });
  mount(<CodeSignIn passwordEnabled />);
  fireEvent.change(screen.getByLabelText(en.auth.email), {
    target: { value: 'member@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: en.auth.codeSend }));
  await waitFor(() => expect(screen.getByLabelText(en.auth.code)).toBeTruthy());
  expect(http.request.mock.calls[0]?.[0]).toEqual({ email: 'member@example.test', type: 'sign-in' });
  expect(screen.getByRole('status').textContent).toBe(
    en.auth.codeSent.replace('{email}', 'member@example.test'),
  );
  const field = screen.getByLabelText(en.auth.code);
  expect(field.getAttribute('autocomplete')).toBe('one-time-code');
  fireEvent.change(field, { target: { value: '12a345' } });
  expect(field).toHaveProperty('value', '12345');
  expect(screen.getByRole('button', { name: en.auth.login })).toHaveProperty('disabled', true);
  expect(screen.getByRole('link', { name: en.auth.passwordLink })).toBeTruthy();
});
it('ADMIN-B65 Continue with Google hands the browser to Better Auth, and a failed one says why', () => {
  http.social.mockReturnValue(new Promise(() => {}));
  mount(<AuthForm mode="login" methods={['password', 'google']} notice="google_unknown" />);
  fireEvent.click(screen.getByRole('button', { name: en.auth.googleLink }));
  expect(http.social).toHaveBeenCalledWith({
    provider: 'google',
    callbackURL: '/home',
    errorCallbackURL: '/login',
  });
  expect(screen.getByRole('alert').textContent).toBe(en.auth.googleUnknown);
  mount(<AuthForm mode="login" methods={['password']} />);
  expect(screen.queryByRole('button', { name: en.auth.googleLink })).toBeNull();
});
it('ADMIN-B76 the passkey button asks the browser, says nothing when cancelled and says why otherwise', async () => {
  mount(<AuthForm mode="login" methods={['password']} />);
  expect(screen.queryByRole('button', { name: en.auth.passkeyLink })).toBeNull();
  http.passkey.mockResolvedValue({ data: null, error: { code: 'AUTH_CANCELLED', status: 400 } });
  mount(<AuthForm mode="login" methods={['passkey']} />, 'ar');
  const button = screen.getByRole('button', { name: ar.auth.passkeyLink });
  fireEvent.click(button);
  await waitFor(() => expect(button).toHaveProperty('disabled', false));
  expect(http.passkey).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).toBeNull();
  http.passkey.mockResolvedValue({ data: null, error: { code: 'INVALID', status: 401 } });
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(ar.auth.passkeyFailed));
});
