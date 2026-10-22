import 'server-only';
import { z } from 'zod';
import { defineHandler, authenticated } from './handler';
import { MailSettingsWrite, MailStatus } from '@/core/config/mail-schema';
import { mailStatus, saveMail, removeMail } from '@/core/mail/settings';
import { mailUser } from '@/core/mail/send';
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
    await mailUser(ctx.db, user, (copy, workspace) => ({
      subject: copy.testSubject.replaceAll('{workspace}', workspace),
      lines: [copy.testBody.replaceAll('{workspace}', workspace)],
    }));
    return { data: { to: user.email } };
  },
});
