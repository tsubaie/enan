import { describe, expect, it } from 'vitest';
import { settingKeys, settingsRegistry, StatusThresholds } from '@/core/config/settings';
import { Setting, SettingWrite } from '../schema/validation';
// ADMIN-B07: the settings page renders from the registry and every write is checked against it,
// so the registry itself is the contract these scenarios hold to.
const workspaceKeys = settingKeys.filter((key) => settingsRegistry[key].scope === 'workspace');
const userKeys = settingKeys.filter((key) => settingsRegistry[key].scope === 'user');
it('ADMIN-B07 a write names a key and a JSON value, and nothing else', () => {
  expect(SettingWrite.parse({ key: 'workspace.name', value: 'Office' })).toEqual({
    key: 'workspace.name',
    value: 'Office',
  });
  expect(SettingWrite.parse({ key: 'notes.types', value: [{ id: 'x' }] }).value).toEqual([
    { id: 'x' },
  ]);
  expect(SettingWrite.safeParse({ key: 'workspace.name' }).success).toBe(false);
  expect(SettingWrite.safeParse({ value: 'Office' }).success).toBe(false);
  expect(
    SettingWrite.safeParse({ key: 'workspace.name', value: 'Office', userId: 'x' }).success,
  ).toBe(false);
  expect(SettingWrite.safeParse({ key: 'workspace.name', value: () => 'Office' }).success).toBe(
    false,
  );
});
it('ADMIN-B07 a listed setting carries its value, its default and the type its control is drawn from', () => {
  expect(
    Setting.parse({ key: 'retention.trash_days', value: 30, default: 30, type: 'number' }),
  ).toEqual({
    key: 'retention.trash_days',
    value: 30,
    default: 30,
    type: 'number',
  });
  expect(Setting.safeParse({ key: 'retention.trash_days', value: 30 }).success).toBe(false);
});
it('ADMIN-B07 every workspace key has a default its own schema accepts and is written by administrators alone', () => {
  expect(workspaceKeys.length).toBeGreaterThan(0);
  for (const key of workspaceKeys) {
    const item = settingsRegistry[key];
    expect(item.schema.safeParse(item.default).success, key).toBe(true);
    expect(item.writeRoles, key).toEqual(['admin']);
    expect(item.readRoles, key).toEqual(['admin']);
  }
});
it('ADMIN-B07 ACCT-B04 the user keys are the four preferences, and every member may set their own', () => {
  expect(userKeys.sort()).toEqual(['user.locale', 'user.numerals', 'user.theme', 'user.timezone']);
  for (const key of userKeys) {
    expect([...settingsRegistry[key].writeRoles].sort(), key).toEqual(['admin', 'member']);
    expect(settingsRegistry[key].schema.safeParse(settingsRegistry[key].default).success, key).toBe(
      true,
    );
  }
});
describe('ADMIN-B09 KPIS-I04 the thresholds setting is validated as a pair of ordered bands', () => {
  const base = { higher: { on: 0.99, near: 0.85 }, lower: { on: 1.01, near: 1.18 } };
  it('ADMIN-B09 KPIS-I04 accepts the default and refuses bands in the wrong order', () => {
    expect(StatusThresholds.parse(base)).toEqual(base);
    expect(StatusThresholds.safeParse({ ...base, higher: { on: 0.85, near: 0.99 } }).success).toBe(
      false,
    );
    expect(StatusThresholds.safeParse({ ...base, lower: { on: 1.18, near: 1.01 } }).success).toBe(
      false,
    );
    // Equal bands collapse "near" to nothing, which is allowed in both directions.
    expect(
      StatusThresholds.safeParse({ higher: { on: 0.9, near: 0.9 }, lower: { on: 1.1, near: 1.1 } })
        .success,
    ).toBe(true);
  });
  it('ADMIN-B09 KPIS-I04 refuses a missing band, a non-positive ratio and anything past one hundred', () => {
    const issue = (value: unknown) => {
      const result = StatusThresholds.safeParse(value);
      return result.success ? [] : result.error.issues.map((item) => item.path.join('.'));
    };
    expect(issue({ higher: base.higher })).toEqual(['lower']);
    expect(issue({ ...base, higher: { on: 0, near: 0.85 } })).toContain('higher.on');
    expect(issue({ ...base, lower: { on: 1.01, near: 101 } })).toContain('lower.near');
    expect(settingsRegistry['kpis.status_thresholds'].schema).toBe(StatusThresholds);
  });
});
