import { expect, it } from 'vitest';
import { hashPassword, placeholderHash } from '../password';

it('ADMIN-B21 a placeholder hash refused while argon2 is busy is retried, not cached', async () => {
  const busy = [hashPassword('first'), hashPassword('second')];
  await expect(placeholderHash()).rejects.toMatchObject({ code: 'rate_limited' });
  await Promise.all(busy);
  await expect(placeholderHash()).resolves.toMatch(/^\$argon2id\$/u);
});
