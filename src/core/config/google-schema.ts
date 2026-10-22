import { z } from 'zod';
// ADMIN-B65: the OAuth client from Google Cloud Console. A blank secret keeps the saved one.
export const GoogleSettingsWrite = z.strictObject({
  clientId: z
    .string()
    .trim()
    .max(200)
    .regex(/^[\w.-]+\.apps\.googleusercontent\.com$/u),
  clientSecret: z.string().trim().max(200).optional(),
});
// Never carries the secret: only whether one is saved, and the address Google must send people to.
export const GoogleStatus = z.object({
  source: z.enum(['saved', 'environment', 'none']),
  clientId: z.string().nullable(),
  hasSecret: z.boolean(),
  redirectUri: z.string(),
});
