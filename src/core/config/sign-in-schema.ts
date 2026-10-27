import { z } from 'zod';
// ADMIN-B64: the ways the login page can offer. Google arrives with its own configuration; passkeys
// are registered by each member on their account page (ADMIN-B76).
export const SignInMethod = z.enum(['password', 'code', 'google', 'passkey']);
export type SignInMethod = z.infer<typeof SignInMethod>;
export const SignInMethods = z.array(SignInMethod).min(1);
export const SignInMethodsStatus = z.object({
  chosen: SignInMethods,
  available: z.record(SignInMethod, z.boolean()),
  enabled: SignInMethods,
});
export const SignInMethodsWrite = z.strictObject({ methods: SignInMethods });
