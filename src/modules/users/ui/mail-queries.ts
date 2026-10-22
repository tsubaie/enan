import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { MailSettingsWrite, MailStatus } from '@/core/config/mail-schema';
import { request } from '@/core/http/client';
const response = z.object({ data: MailStatus });
export function useMailStatus() {
  return useQuery({
    queryKey: ['admin', 'mail'],
    refetchOnWindowFocus: false,
    queryFn: () => request('/admin/mail', response),
  });
}
export function useSaveMail() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: z.infer<typeof MailSettingsWrite>) =>
      request('/admin/mail', response, {
        method: 'PUT',
        body: { ...input, password: input.password ?? '' },
      }),
    gcTime: 0,
    onSuccess: (data) => client.setQueryData(['admin', 'mail'], data),
  });
}
export function useRemoveMail() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => request('/admin/mail', response, { method: 'DELETE', body: {} }),
    onSuccess: (data) => client.setQueryData(['admin', 'mail'], data),
  });
}
export function useTestMail() {
  return useMutation({
    mutationFn: () =>
      request('/admin/mail/test', z.object({ data: z.object({ to: z.string() }) }), {
        method: 'POST',
        body: {},
      }),
  });
}
