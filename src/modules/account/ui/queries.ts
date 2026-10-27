import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { request } from '@/core/http/client';
import { authCall, authClient } from '@/core/http/auth-client';
import { Account, type AccountPatch } from '../schema/validation';
const response = z.object({ data: Account });
const revoked = z.object({ data: z.object({ revoked: z.number().int() }) });
export const accountKey = ['account'];
export function useAccount() {
  return useQuery({ queryKey: accountKey, queryFn: () => request('/account', response) });
}
function useAccountMutation<I, O>(send: (input: I) => Promise<O>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSettled: () => client.invalidateQueries({ queryKey: accountKey }),
  });
}
export function usePatchAccount() {
  return useAccountMutation((input: AccountPatch) =>
    request('/account', response, { method: 'PATCH', body: z.json().parse(input) }),
  );
}
export function useChangeEmail() {
  return useAccountMutation((input: { revision: number; email: string; current: string }) =>
    request('/account/email', response, { method: 'POST', body: input }),
  );
}
// ACCT-B02: the current session survives, so nothing here signs the reader out or clears the cache.
export function useChangePassword() {
  return useAccountMutation((input: { current: string; next: string }) =>
    request('/account/password', revoked, { method: 'POST', body: input }),
  );
}
export function useRevokeSession() {
  return useAccountMutation((id: string) =>
    request(`/account/sessions/${id}`, z.object({ data: z.object({ id: z.uuid() }) }), {
      method: 'DELETE',
    }),
  );
}
export function useSignOutOthers() {
  return useAccountMutation(() =>
    request('/account/sessions/revoke-others', revoked, { method: 'POST', body: {} }),
  );
}
// ACCT-B10: passkeys are Better Auth's to add and remove; the account query lists them.
export function useAddPasskey(word: Parameters<typeof authCall>[1]) {
  return useAccountMutation((input: { name: string; currentPassword: string }) =>
    authCall(
      authClient.passkey.addPasskey({
        ...(input.name ? { name: input.name } : {}),
        fetchOptions: { headers: { 'x-current-password': input.currentPassword } },
      }),
      word,
    ),
  );
}
export function useRemovePasskey(word: Parameters<typeof authCall>[1]) {
  return useAccountMutation((id: string) =>
    authCall(authClient.passkey.deletePasskey({ id }), word),
  );
}
