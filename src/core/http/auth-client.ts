import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { ApiError } from './client';
// ADR 0055: the browser's side of Better Auth. Every call carries the header the server requires
// on state-changing requests (ADR 0005).
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [emailOTPClient()],
  fetchOptions: { headers: { 'X-Requested-With': 'Enan' } },
});
type Failure = { status: number; code?: string | undefined; message?: string | undefined };
// Better Auth's failures in the app's own error codes, so the page words them in the reader's
// language (`errors.*`) like any other refusal.
export function errorCode(failure: Failure) {
  if (failure.status === 429) return 'rate_limited';
  if (failure.status === 403) return 'forbidden';
  if (failure.status === 401 || failure.status === 400) return 'unauthenticated';
  return 'internal';
}
// Better Auth answers `{ data, error }`; a query or mutation wants a value or a thrown error.
export async function authCall<T>(
  call: Promise<{ data: T; error: null } | { data: null; error: Failure }>,
  word: (code: ReturnType<typeof errorCode>) => string,
): Promise<T> {
  const result = await call;
  if (result.error) {
    const code = errorCode(result.error);
    throw new ApiError(code, word(code), null, result.error.code ?? '');
  }
  return result.data;
}
