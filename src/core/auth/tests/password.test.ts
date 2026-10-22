import { expect, it } from 'vitest';
import { hashPassword } from '../password';

it('ADMIN-B21 argon2 admits two hashes at a time and refuses a third with a retry, then admits it', async () => {
  const busy = [hashPassword('first'), hashPassword('second')];
  await expect(hashPassword('third')).rejects.toMatchObject({ code: 'rate_limited' });
  await Promise.all(busy);
  await expect(hashPassword('third')).resolves.toMatch(/^\$argon2id\$v=19\$m=65536,p=4,t=3\$/u);
});
