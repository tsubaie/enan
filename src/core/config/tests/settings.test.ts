import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDatabase, db } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { insertUser } from '@/core/db/auth-repo';
import { getSetting, hasSetting, writeSetting } from '@/core/db/settings-repo';
import { settingKeys, settingsRegistry } from '../settings';
import { appVersion } from '../version';
import { id } from '@/core/db/ids';
import { midnightBoundaries } from '../../../../tests/fixtures/timezones';
let actor: string;
beforeAll(async () => {
  await migrateDatabase();
});
beforeEach(async () => {
  await clearDatabase();
  actor = (
    await insertUser(db(), {
      id: id(),
      name: 'S',
      email: 's@example.test',
      passwordHash: 'x',
      role: 'admin',
    })
  ).id;
});
afterAll(() => closeDatabase());
describe('ADMIN-B07 typed settings registry', () => {
  it('rejects secret-like keys and unqualified model identifiers', () => {
    expect(settingKeys.some((key) => /secret|password|token$|api.?key/iu.test(key))).toBe(false);
    expect(
      settingsRegistry['ai.model.default'].schema.safeParse('anthropic/claude-opus-5').success,
    ).toBe(true);
    expect(settingsRegistry['ai.model.default'].schema.safeParse('gpt-5').success).toBe(false);
  });
  it('applies the schema and default when no row exists and returns typed values after a write', async () => {
    expect(await getSetting(db(), 'workspace.timezone')).toBe('UTC');
    expect(await getSetting(db(), 'retention.trash_days')).toBe(30);
    const zone = midnightBoundaries[0]?.timezone ?? 'UTC';
    await writeSetting(db(), 'workspace.timezone', zone, actor);
    expect(await getSetting(db(), 'workspace.timezone')).toBe(zone);
    expect(await hasSetting(db(), 'user.locale', actor)).toBe(false);
    await writeSetting(db(), 'user.locale', 'ar', actor, actor);
    expect(await hasSetting(db(), 'user.locale', actor)).toBe(true);
    expect(await getSetting(db(), 'user.locale', actor)).toBe('ar');
  });
  it('refuses a value that fails the key schema and ignores a stored value that no longer parses', async () => {
    await expect(writeSetting(db(), 'retention.trash_days', -1, actor)).rejects.toThrow();
    await db().run(
      sql`insert into settings (key, scope, value) values ('retention.trash_days', 'workspace', '"many"')`,
    );
    expect(await getSetting(db(), 'retention.trash_days')).toBe(30);
  });
  it('ADMIN-B07 ADMIN-B26 writing null to a setting that takes it clears it back to none', async () => {
    const nullable = settingKeys.filter(
      (key) => settingsRegistry[key].schema.safeParse(null).success,
    );
    expect(nullable.length).toBeGreaterThan(0);
    for (const key of nullable) expect(settingsRegistry[key].default).toBeNull();
    await writeSetting(db(), 'ai.monthly_budget_micros', 5_000_000, actor);
    expect(await getSetting(db(), 'ai.monthly_budget_micros')).toBe(5_000_000);
    await writeSetting(db(), 'ai.monthly_budget_micros', null, actor);
    expect(await getSetting(db(), 'ai.monthly_budget_micros')).toBeNull();
    // Clearing what was never set is not an error either.
    await writeSetting(db(), 'notes.default_type', null, actor);
    expect(await getSetting(db(), 'notes.default_type')).toBeNull();
  });
  it('ADMIN-B48 every retention setting accepts 0 (never) and refuses a negative number', async () => {
    for (const key of [
      'retention.trash_days',
      'retention.meeting_files_days',
      'retention.backup_count',
    ] as const) {
      expect(settingsRegistry[key].schema.safeParse(0).success).toBe(true);
      expect(settingsRegistry[key].schema.safeParse(-1).success).toBe(false);
      await writeSetting(db(), key, 0, actor);
      expect(await getSetting(db(), key)).toBe(0);
    }
  });
});
it('ADMIN-B12 the application version comes from package.json', () => {
  expect(appVersion).toMatch(/^\d+\.\d+\.\d+/u);
});
