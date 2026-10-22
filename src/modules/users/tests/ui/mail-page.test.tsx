// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { ApiError } from '@/core/http/client';
import { MailPage } from '../../ui/MailPage';
import { mount } from './harness';

const mutation = () => ({
  mutate: vi.fn(),
  isPending: false,
  isSuccess: false,
  error: null as Error | null,
  data: undefined as { data: { to: string } } | undefined,
});
const state = vi.hoisted(() => ({
  status: {} as object,
  test: {} as object,
  save: {} as object,
  remove: {} as object,
}));
vi.mock('../../ui/mail-queries', () => ({
  useMailStatus: () => ({ isPending: false, error: null, data: { data: state.status } }),
  useTestMail: () => state.test,
  useSaveMail: () => state.save,
  useRemoveMail: () => state.remove,
}));
const saved = {
  source: 'saved',
  host: 'smtp.example.test',
  port: 587,
  username: 'sender@example.test',
  fromAddress: 'office@example.test',
  hasPassword: true,
};
beforeEach(() => {
  state.status = saved;
  state.test = mutation();
  state.save = mutation();
  state.remove = mutation();
});

it('ADMIN-B60 a saved server fills the form but never the password, and a blank one is kept', () => {
  mount(<MailPage />);
  expect(screen.getByText(en.admin.mailSaved)).toBeTruthy();
  expect(screen.getByLabelText(en.admin.mailHost)).toHaveProperty('value', 'smtp.example.test');
  expect(screen.getByLabelText(en.admin.mailPassword)).toHaveProperty('value', '');
  expect(screen.getByText(en.admin.mailPasswordKept)).toBeTruthy();
  expect(screen.getByRole('button', { name: en.admin.mailRemove })).toBeTruthy();
});
it('ADMIN-B60 with nothing set up the test cannot be sent and the Gmail setup is explained', () => {
  state.status = {
    source: 'none',
    host: null,
    port: null,
    username: null,
    fromAddress: null,
    hasPassword: false,
  };
  mount(<MailPage />);
  expect(screen.getByText(en.admin.mailNotSetUp)).toBeTruthy();
  expect(screen.getByRole('button', { name: en.admin.mailSendTest })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.getByText(en.admin.mailServerHelp)).toBeTruthy();
  expect(screen.getByLabelText(en.admin.mailPort)).toHaveProperty('value', '587');
  expect(screen.queryByRole('button', { name: en.admin.mailRemove })).toBeNull();
});
it('ADMIN-B61 Send test email sends, then says where it went or why it failed, in Arabic too', () => {
  const test = mutation();
  state.test = test;
  mount(<MailPage />);
  fireEvent.click(screen.getByRole('button', { name: en.admin.mailSendTest }));
  expect(test.mutate).toHaveBeenCalled();
  state.test = { ...mutation(), data: { data: { to: 'admin@example.test' } } };
  mount(<MailPage />);
  expect(screen.getByRole('status').textContent).toContain('admin@example.test');
  state.test = {
    ...mutation(),
    error: new ApiError('mail_failed', 'x', { reason: 'auth' }, 'request'),
  };
  mount(<MailPage />, 'ar');
  expect(screen.getByRole('alert').textContent).toBe(ar.admin.mailError_auth);
});
