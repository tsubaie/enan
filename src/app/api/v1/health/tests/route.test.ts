import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { closeDatabase } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { GET } from '../route';
// The session is the one seam replaced: who is asking decides how much the answer says.
const session = vi.hoisted(() => ({ user: null as { role: string } | null }));
vi.mock('@/core/auth/session', () => ({ currentUser: async () => session.user }));
beforeAll(() => migrateDatabase());
afterAll(() => closeDatabase());
it('ADMIN-B54 health tells the public its status, version and revision only; an admin sees the details', async () => {
  const visitor = await (await GET()).json();
  expect(Object.keys(visitor).sort()).toEqual(['db', 'revision', 'status', 'version']);
  session.user = { role: 'member' };
  expect(await (await GET()).json()).not.toHaveProperty('jobs');
  session.user = { role: 'admin' };
  expect(await (await GET()).json()).toMatchObject({
    db: true,
    jobs: { queued: expect.any(Number) },
    storage: { usedBytes: expect.any(Number) },
  });
});
