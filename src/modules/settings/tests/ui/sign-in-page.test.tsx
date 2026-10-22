// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { screen } from '@testing-library/react';
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
    available: { password: true, code: false, google: false },
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
      available: { password: true, code: true, google: false },
      enabled: ['password', 'code'],
    },
    'ar',
  );
  expect(box(ar.admin.signInMethod_password).getAttribute('aria-disabled')).toBeNull();
  expect(box(ar.admin.signInMethod_code).getAttribute('aria-checked')).toBe('true');
  expect(screen.queryByText(ar.admin.signInLast)).toBeNull();
});
it('ADMIN-B65 the Google client shows the redirect address to register and never the secret', () => {
  const client = newClient();
  client.setQueryData(['admin', 'sign-in'], {
    data: {
      chosen: ['password', 'code', 'google'],
      available: { password: true, code: false, google: true },
      enabled: ['password', 'google'],
    },
  });
  client.setQueryData(['admin', 'sign-in', 'google'], {
    data: {
      source: 'saved',
      clientId: '1234-abc.apps.googleusercontent.com',
      hasSecret: true,
      redirectUri: 'https://office.example.test/api/v1/auth/google/callback',
    },
  });
  mount(<SignInPage />, 'en', client);
  expect(box(en.admin.signInMethod_google).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('https://office.example.test/api/v1/auth/google/callback')).toBeTruthy();
  expect(screen.getByLabelText(en.admin.googleClientId)).toHaveProperty(
    'value',
    '1234-abc.apps.googleusercontent.com',
  );
  expect(screen.getByLabelText(en.admin.googleClientSecret)).toHaveProperty('value', '');
  expect(screen.getByText(en.admin.googleSecretKept)).toBeTruthy();
});
