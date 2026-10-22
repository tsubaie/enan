import 'server-only';
import { seal, unseal } from '@/core/auth/sealed';
import { AppError } from '@/core/http/errors';
const purpose = 'ai-credentials-v1';
export function encryptKey(apiKey: string, provider: string) {
  return seal(apiKey, purpose, provider);
}
export function decryptKey(value: string, provider: string) {
  const apiKey = unseal(value, purpose, provider);
  if (apiKey === null) throw new AppError('ai_unavailable', { reason: 'credentials' });
  return apiKey;
}
