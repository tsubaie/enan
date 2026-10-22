import 'server-only';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { Locale as Locales } from '@/core/config/defaults';
import { type MailFailure as Failure } from '@/core/config/mail-schema';
import { AppError } from '@/core/http/errors';
import { logger } from '@/core/config/logger';
import { type Database } from '@/core/db/client';
import { getSetting, hasSetting } from '@/core/db/settings-repo';
import { mailServer, type MailServer } from './settings';
type MailFailure = z.infer<typeof Failure>;
type Locale = z.infer<typeof Locales>;
export type Mail = { to: string; subject: string; lines: string[] };
export function mailCatalog(locale: Locale) {
  return locale === Locales.options[1] ? ar.mail : en.mail;
}
const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escape = (value: string) => value.replace(/[&<>"']/gu, (c) => escapes[c] ?? c);
// ADMIN-B62: every message is plain text with an HTML twin that declares its language and
// direction, so an Arabic message reads right to left in any mail client.
export function render(locale: Locale, mail: Mail) {
  const dir = locale === Locales.options[1] ? 'rtl' : 'ltr';
  const body = mail.lines.map((line) => `<p>${escape(line)}</p>`).join('');
  return {
    text: mail.lines.join('\n\n'),
    html: `<!doctype html><html lang="${locale}" dir="${dir}"><body dir="${dir}">${body}</body></html>`,
  };
}
const failures: Record<string, MailFailure> = {
  EAUTH: 'auth',
  ENOAUTH: 'auth',
  ECONNECTION: 'network',
  ETIMEDOUT: 'network',
  ESOCKET: 'network',
  EDNS: 'network',
  ETLS: 'tls',
  EREQUIRETLS: 'tls',
  EENVELOPE: 'rejected',
  EMESSAGE: 'rejected',
};
const Failed = z.object({ code: z.string() });
export function mailFailure(error: unknown): MailFailure {
  const parsed = Failed.safeParse(error);
  return (parsed.success && failures[parsed.data.code]) || 'server';
}
// ADMIN-B61: credentials and messages never travel in clear text. Port 465 is TLS from the first
// byte; any other port must upgrade with STARTTLS or the message is not sent. Certificates are
// verified, and the message may not pull in local files or URLs.
export async function deliver(server: MailServer, sender: string, locale: Locale, mail: Mail) {
  const transport = nodemailer.createTransport({
    host: server.host,
    port: server.port,
    secure: server.port === 465,
    requireTLS: server.port !== 465,
    ...(server.username ? { auth: { user: server.username, pass: server.password ?? '' } } : {}),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    await transport.sendMail({
      from: { name: sender, address: server.fromAddress },
      to: mail.to,
      subject: mail.subject,
      ...render(locale, mail),
    });
  } catch (error) {
    const reason = mailFailure(error);
    logger.warn({ err: error, reason }, 'Mail was not sent');
    throw new AppError('mail_failed', { reason });
  } finally {
    transport.close();
  }
}
type Copy = ReturnType<typeof mailCatalog>;
// A message to one member, in their language (their own choice, else the workspace's), from the
// workspace by name. The copy is filled from that language's catalog.
export async function mailUser(
  database: Database,
  user: { id: string; email: string },
  compose: (copy: Copy, workspace: string) => { subject: string; lines: string[] },
) {
  const server = await mailServer(database);
  if (!server) throw new AppError('rule_violation', { reason: 'mail_not_configured' });
  const locale = (await hasSetting(database, 'user.locale', user.id))
    ? await getSetting(database, 'user.locale', user.id)
    : await getSetting(database, 'workspace.default_locale');
  const workspace = await getSetting(database, 'workspace.name');
  await deliver(server, workspace, locale, {
    to: user.email,
    ...compose(mailCatalog(locale), workspace),
  });
}
