import 'server-only';
import { env } from '@/core/config/env';
import { MailSettingsWrite, MailStatus } from '@/core/config/mail-schema';
import { seal, unseal } from '@/core/auth/sealed';
import { type Database } from '@/core/db/client';
import {
  readMailSettings,
  saveMailSettings,
  deleteMailSettings,
} from '@/core/db/mail-settings-repo';
import { writeAudit } from '@/core/db/audit-repo';
import { AppError } from '@/core/http/errors';
// ADMIN-B60 (ADR 0053): the mail server saved from Administration wins over the SMTP_* variables,
// and removing it falls back to them, as the AI key does (ADMIN-B24). The password is sealed to
// this purpose and this host and user, so a sealed value copied to another row does not open.
const purpose = 'mail-credentials-v1';
const context = (host: string, username: string) => `${host}\n${username}`;
export type MailServer = {
  host: string;
  port: number;
  username: string;
  password: string | null;
  fromAddress: string;
};
export async function mailStatus(database: Database) {
  const saved = await readMailSettings(database);
  if (saved)
    return MailStatus.parse({
      source: 'saved',
      host: saved.host,
      port: saved.port,
      username: saved.username,
      fromAddress: saved.fromAddress,
      hasPassword: saved.encryptedPassword !== null,
    });
  const config = env();
  const configured = Boolean(config.SMTP_HOST && config.MAIL_FROM);
  return MailStatus.parse({
    source: configured ? 'environment' : 'none',
    host: configured ? config.SMTP_HOST : null,
    port: configured ? config.SMTP_PORT : null,
    username: configured ? (config.SMTP_USER ?? '') : null,
    fromAddress: configured ? config.MAIL_FROM : null,
    hasPassword: configured && Boolean(config.SMTP_PASSWORD),
  });
}
// The server to send through, or null when none is configured. A saved password that no longer
// opens (SESSION_SECRET changed) fails closed: nothing is sent until it is saved again.
export async function mailServer(database: Database): Promise<MailServer | null> {
  const saved = await readMailSettings(database);
  if (saved) {
    const password =
      saved.encryptedPassword === null
        ? null
        : unseal(saved.encryptedPassword, purpose, context(saved.host, saved.username));
    if (saved.encryptedPassword !== null && password === null)
      throw new AppError('mail_failed', { reason: 'credentials' });
    return {
      host: saved.host,
      port: saved.port,
      username: saved.username,
      password,
      fromAddress: saved.fromAddress,
    };
  }
  const config = env();
  if (!config.SMTP_HOST || !config.MAIL_FROM) return null;
  return {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    username: config.SMTP_USER ?? '',
    password: config.SMTP_PASSWORD ?? null,
    fromAddress: config.MAIL_FROM,
  };
}
export async function saveMail(database: Database, actor: string, input: unknown) {
  const value = MailSettingsWrite.parse(input);
  const previous = await readMailSettings(database);
  // A blank password keeps the saved one, which is re-sealed when the host or user it is bound to
  // changes. A saved password that no longer opens is dropped rather than carried forward.
  // With nothing saved yet, the form was filled from the environment and says a password is kept
  // (ADMIN-B60): that is SMTP_PASSWORD, kept while it is still the same server and user. The
  // schema lowercases the server name, so the variable is compared the same way.
  const config = env();
  const fromEnvironment =
    !previous &&
    value.host === config.SMTP_HOST?.toLowerCase() &&
    value.username === (config.SMTP_USER ?? '')
      ? (config.SMTP_PASSWORD ?? null)
      : null;
  const kept = value.password
    ? null
    : previous?.encryptedPassword
      ? unseal(previous.encryptedPassword, purpose, context(previous.host, previous.username))
      : fromEnvironment;
  const password = value.password || kept;
  await saveMailSettings(database, {
    host: value.host,
    port: value.port,
    username: value.username,
    fromAddress: value.fromAddress,
    encryptedPassword: password
      ? seal(password, purpose, context(value.host, value.username))
      : null,
  });
  await writeAudit(database, actor, 'mail.settings.save', 'mail_settings', null, {
    host: value.host,
    port: value.port,
    fromAddress: value.fromAddress,
  });
  return mailStatus(database);
}
export async function removeMail(database: Database, actor: string) {
  await deleteMailSettings(database);
  await writeAudit(database, actor, 'mail.settings.remove', 'mail_settings', null, {});
  return mailStatus(database);
}
