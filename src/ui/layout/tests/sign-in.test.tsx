// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { AuthForm } from '../AuthForm';
import { CodeSignIn } from '../CodeSignIn';
import { mount } from '../../../../tests/fixtures/mount';

const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/core/http/client', async (original) => ({
  ...(await original<typeof import('@/core/http/client')>()),
  request: http.request,
}));
vi.mock('../Preferences', () => ({ Preferences: () => null }));
afterEach(() => http.request.mockReset());

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
  http.request.mockResolvedValue({ data: null });
  mount(<CodeSignIn passwordEnabled />);
  fireEvent.change(screen.getByLabelText(en.auth.email), {
    target: { value: 'member@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: en.auth.codeSend }));
  await waitFor(() => expect(screen.getByLabelText(en.auth.code)).toBeTruthy());
  expect(http.request.mock.calls[0]?.[0]).toBe('/auth/code');
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
it('ADMIN-B65 Continue with Google is a full navigation to the server, and a failed one says why', () => {
  mount(<AuthForm mode="login" methods={['password', 'google']} notice="google_unknown" />);
  const google = screen.getByRole('link', { name: en.auth.googleLink });
  expect(google.getAttribute('href')).toBe('/api/v1/auth/google');
  expect(screen.getByRole('alert').textContent).toBe(en.auth.googleUnknown);
  mount(<AuthForm mode="login" methods={['password']} />);
  expect(screen.queryByRole('link', { name: en.auth.googleLink })).toBeNull();
});
