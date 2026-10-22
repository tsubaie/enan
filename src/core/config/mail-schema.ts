import { z } from 'zod';
// ADMIN-B60: what an administrator saves for the outgoing mail server. A blank password keeps the
// saved one, so changing the sender does not mean typing the password again.
export const MailSettingsWrite = z.strictObject({
  host: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/u),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().max(320),
  password: z.string().max(1024).optional(),
  fromAddress: z.email().max(320),
});
// Never carries the password, saved or not: only whether there is one.
export const MailStatus = z.object({
  source: z.enum(['saved', 'environment', 'none']),
  host: z.string().nullable(),
  port: z.number().nullable(),
  username: z.string().nullable(),
  fromAddress: z.string().nullable(),
  hasPassword: z.boolean(),
});
// ADMIN-B61: why a message could not be sent, in categories an administrator can act on.
export const MailFailure = z.enum(['auth', 'network', 'tls', 'rejected', 'credentials', 'server']);
