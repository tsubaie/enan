import 'server-only';
import { z } from 'zod';
import { defineHandler, authenticated } from './handler';
import { AppError } from './errors';
import { MailSettingsWrite, MailStatus } from '@/core/config/mail-schema';
import { mailStatus, mailServer, saveMail, removeMail } from '@/core/mail/settings';
import { deliver, mailCatalog } from '@/core/mail/send';
import { getSetting, hasSetting } from '@/core/db/settings-repo';
const response = z.object({ data: MailStatus });
export const read = defineHandler({
  guard: 'admin',
  input: z.strictObject({}),
  response,
  handler: async (_, ctx) => ({ data: await mailStatus(ctx.db) }),
});
export const save = defineHandler({
  guard: 'admin',
  input: MailSettingsWrite,
  response,
  handler: async (input, ctx) => ({
    data: await saveMail(ctx.db, authenticated(ctx).user.id, input),
  }),
});
export const remove = defineHandler({
  guard: 'admin',
  input: z.strictObject({}),
  response,
  handler: async (_, ctx) => ({ data: await removeMail(ctx.db, authenticated(ctx).user.id) }),
});
// ADMIN-B61: the test message goes to the administrator who asked, in their language. Talking to
// the mail server is slow, so it runs outside the write lock (ADR 0045) and writes nothing.
export const test = defineHandler({
  guard: 'admin',
  input: z.strictObject({}),
  response: z.object({ data: z.object({ to: z.string() }) }),
  transaction: false,
  handler: async (_, ctx) => {
    const { user } = authenticated(ctx);
    const server = await mailServer(ctx.db);
    if (!server) throw new AppError('rule_violation', { reason: 'mail_not_configured' });
    const locale = (await hasSetting(ctx.db, 'user.locale', user.id))
      ? await getSetting(ctx.db, 'user.locale', user.id)
      : await getSetting(ctx.db, 'workspace.default_locale');
    const workspace = await getSetting(ctx.db, 'workspace.name');
    const copy = mailCatalog(locale);
    await deliver(server, workspace, locale, {
      to: user.email,
      subject: copy.testSubject.replaceAll('{workspace}', workspace),
      lines: [copy.testBody.replaceAll('{workspace}', workspace)],
    });
    return { data: { to: user.email } };
  },
});
