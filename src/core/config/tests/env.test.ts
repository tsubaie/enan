import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseEnvironment, secureCookies } from '../env';
const base = {
  DATABASE_URL: 'file:/var/lib/executiveos/data/executiveos.db',
  SESSION_SECRET: 'a'.repeat(32),
};
describe('environment', () => {
  it('ADMIN-B17 production refuses a plain-HTTP APP_URL and keeps the loopback opt-out', () => {
    const attempt = (NODE_ENV: string, APP_URL: string) =>
      parseEnvironment({ ...base, NODE_ENV, APP_URL });
    expect(() => attempt('production', 'http://office.example.test')).toThrow(z.ZodError);
    try {
      attempt('production', 'http://office.example.test');
    } catch (error) {
      expect(error instanceof z.ZodError && error.issues[0]?.path).toEqual(['APP_URL']);
    }
    expect(attempt('production', 'https://office.example.test').APP_URL).toBe(
      'https://office.example.test',
    );
    expect(attempt('production', 'http://localhost:3000').APP_URL).toBe('http://localhost:3000');
    expect(attempt('production', 'http://127.0.0.1:3000').APP_URL).toBe('http://127.0.0.1:3000');
    expect(attempt('development', 'http://office.example.test').APP_URL).toBe(
      'http://office.example.test',
    );
  });
  it('ADMIN-B17 the session cookie Secure flag follows the validated deployment mode', () => {
    const flag = (NODE_ENV: string, APP_URL: string) =>
      secureCookies(parseEnvironment({ ...base, NODE_ENV, APP_URL }));
    expect(flag('production', 'https://office.example.test')).toBe(true);
    expect(flag('production', 'http://localhost:3000')).toBe(false);
    expect(flag('development', 'http://localhost:3000')).toBe(false);
    expect(flag('development', 'https://dev.example.test')).toBe(true);
  });
  it('ADMIN-B20 trusted proxy CIDRs are validated at startup so a typo cannot disable throttling', () => {
    const attempt = (TRUSTED_PROXY_CIDRS: string) =>
      parseEnvironment({ ...base, TRUSTED_PROXY_CIDRS });
    expect(attempt('').TRUSTED_PROXY_CIDRS).toBe('');
    expect(attempt('10.0.0.0/8, 192.168.0.0/16, fd00::/8').TRUSTED_PROXY_CIDRS).toContain(
      '10.0.0.0/8',
    );
    expect(attempt('172.18.0.5').TRUSTED_PROXY_CIDRS).toBe('172.18.0.5');
    expect(() => attempt('10.0.0.0/33')).toThrow(z.ZodError);
    expect(() => attempt('not-an-address')).toThrow(z.ZodError);
    expect(() => attempt('10.0.0.0/8, nonsense')).toThrow(z.ZodError);
  });
  it('ADMIN-B35 startup refuses a DATABASE_URL that does not name a SQLite file: URL', () => {
    const attempt = (DATABASE_URL: string) => parseEnvironment({ ...base, DATABASE_URL });
    expect(() => attempt('postgresql://user:pass@db:5432/app')).toThrow(z.ZodError);
    try {
      attempt('postgresql://user:pass@db:5432/app');
    } catch (error) {
      expect(error instanceof z.ZodError && error.issues[0]?.path).toEqual(['DATABASE_URL']);
      expect(error instanceof z.ZodError && error.issues[0]?.message).toContain('file:');
    }
    expect(() => attempt('')).toThrow(z.ZodError);
    expect(() => attempt('./tmp/dev.db')).toThrow(z.ZodError);
    // A relative path becomes absolute, so every process of the checkout names one file.
    const relative = attempt('file:./tmp/dev.db').DATABASE_URL;
    expect(relative.startsWith('file:/')).toBe(true);
    expect(relative.endsWith('/tmp/dev.db')).toBe(true);
    expect(attempt('file:///var/lib/executiveos/data/executiveos.db').DATABASE_URL).toContain(
      'file:///',
    );
  });
  it('the test runner only ever opens the disposable DATABASE_URL_TEST file', () => {
    const parsed = parseEnvironment({
      ...base,
      NODE_ENV: 'test',
      DATABASE_URL_TEST: 'file:./tmp/executiveos_test.db',
    });
    expect(parsed.DATABASE_URL_TEST?.endsWith('/tmp/executiveos_test.db')).toBe(true);
    expect(parsed.DATABASE_URL_TEST?.startsWith('file:/')).toBe(true);
    expect(() =>
      parseEnvironment({ ...base, NODE_ENV: 'test', DATABASE_URL_TEST: 'postgresql://x/y' }),
    ).toThrow(z.ZodError);
  });
  it('ADMIN-B22 a configured recovery token must carry real entropy', () => {
    const attempt = (RECOVERY_TOKEN: string) => parseEnvironment({ ...base, RECOVERY_TOKEN });
    expect(attempt('').RECOVERY_TOKEN).toBeUndefined();
    expect(attempt('r'.repeat(32)).RECOVERY_TOKEN).toHaveLength(32);
    expect(() => attempt('letmein')).toThrow(z.ZodError);
    try {
      attempt('letmein');
    } catch (error) {
      expect(error instanceof z.ZodError && error.issues[0]?.path).toEqual(['RECOVERY_TOKEN']);
    }
  });
});
