import { expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../password';

// argon2 0.45.2 writes the parameters in PHC order (m, t, p); 0.45.1 wrote m, p, t. Both read back.
const params = /^\$argon2id\$v=19\$m=65536,t=3,p=4\$/u;
// Hashed with argon2 0.45.1 from the password "s3cret": a hash stored before the upgrade.
const stored =
  '$argon2id$v=19$m=65536,p=4,t=3$GMH0/RdQUx3T6p4UcnMqDw$SenzHO0z2zuhY6/q8dr/bcLl4GI6NIR4hGFbym52oU0';

it('ADMIN-B21 argon2 admits two hashes at a time and refuses a third with a retry, then admits it', async () => {
  const busy = [hashPassword('first'), hashPassword('second')];
  await expect(hashPassword('third')).rejects.toMatchObject({ code: 'rate_limited' });
  await Promise.all(busy);
  await expect(hashPassword('third')).resolves.toMatch(params);
});
it('ADMIN-B21 a hash stored by an earlier argon2 release still verifies, and only its own password', async () => {
  await expect(verifyPassword(stored, 's3cret')).resolves.toBe(true);
  await expect(verifyPassword(stored, 'wrong')).resolves.toBe(false);
});
