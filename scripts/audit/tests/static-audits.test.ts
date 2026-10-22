import { describe, expect, it } from 'vitest';
import { readFile, mkdtemp, cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  collectModule,
  evaluateLintDirectives,
  evaluateModule,
  evaluateTopLevel,
  parseManifest,
  parseTopLevel,
} from '../structure';
import { argumentNames, evaluate as evaluateI18n, scanUsages } from '../i18n';
import { isScanned, parseDenylist, scanText } from '../portability';
import { parseSpec } from '../lib/specs';
import { evaluateMigrations } from '../migrations';
import { baseline, classify, readMigrations, schemaLabels } from '../../build/schema-labels';
const fixture = (path: string) => fileURLToPath(new URL(`./fixtures/${path}`, import.meta.url));
const rules = (findings: { rule: string; message: string }[]) =>
  findings.map((f) => `${f.rule}:${f.message}`);
describe('audit:structure', () => {
  it('rejects a module with an unlisted file and no tests, and accepts a complete one', async () => {
    const doc = await readFile(fixture('structure/docs/02-architecture.md'), 'utf8');
    const manifest = parseManifest(doc);
    expect(manifest.find((row) => row.entry === 'tests')?.required).toBe(true);
    const root = fixture('structure');
    const spec = parseSpec(
      'docs/features/good.md',
      await readFile(fixture('structure/docs/features/good.md'), 'utf8'),
    );
    const bad = evaluateModule(await collectModule(root, 'bad', [spec]), manifest);
    expect(rules(bad)).toEqual(
      expect.arrayContaining([
        'module-manifest:missing required tests',
        'module-manifest:unlisted entry helpers.ts',
        'module-spec:no feature spec',
        'module-manifest:schema/index.ts re-exports db.ts without server-only',
      ]),
    );
    expect(evaluateModule(await collectModule(root, 'good', [spec]), manifest)).toEqual([]);
  });
  it('recognizes jobs registered through the module server manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'manifest-registration-'));
    try {
      await cp(fixture('structure'), root, { recursive: true });
      await mkdir(join(root, 'src/core/modules'), { recursive: true });
      await writeFile(
        join(root, 'src/core/modules/registry.ts'),
        "import { server } from '@/modules/good';\nexport const serverModules = [server];\n",
      );
      await writeFile(
        join(root, 'src/modules/good/index.ts'),
        "import { jobs } from './jobs';\nexport const server = { id: 'good', jobs: jobs };\n",
      );
      expect((await collectModule(root, 'good', [])).jobsRegistered).toBe(true);
      await writeFile(
        join(root, 'src/core/modules/registry.ts'),
        'export const serverModules = [];',
      );
      expect((await collectModule(root, 'good', [])).jobsRegistered).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('rejects a top-level entry that is not in the repository layout', async () => {
    const allowed = parseTopLevel(
      await readFile(fixture('structure/docs/02-architecture.md'), 'utf8'),
    );
    expect(allowed.has('docs/')).toBe(true);
    expect(allowed.has('AGENTS.md')).toBe(true);
    expect(rules(evaluateTopLevel(['docs/x.md', 'stray.txt', 'notes/a.md'], allowed))).toEqual([
      'top-level-entry:not in the repository layout',
      'top-level-entry:not in the repository layout',
    ]);
  });
  it('rejects inline lint directives in source files', () => {
    const text = [
      'const a = 1; // eslint-disable-line no-console',
      '/* oxlint-disable */',
      '/* eslint no-console: off */',
      '// oxlint-enable',
      'const disable = "lint";',
    ].join('\n');
    expect(evaluateLintDirectives('src/ui/Example.tsx', text).map((f) => f.file)).toEqual([
      'src/ui/Example.tsx:1',
      'src/ui/Example.tsx:2',
      'src/ui/Example.tsx:3',
      'src/ui/Example.tsx:4',
    ]);
    expect(evaluateLintDirectives('docs/07-coding-guidelines.md', text)).toEqual([]);
  });
});
describe('audit:i18n', () => {
  const Catalog = z.record(z.string(), z.record(z.string(), z.string()));
  it('rejects missing keys, invalid ICU, argument drift and unresolved usages', async () => {
    const en = Catalog.parse(JSON.parse(await readFile(fixture('i18n/en.json'), 'utf8')));
    const ar = Catalog.parse(JSON.parse(await readFile(fixture('i18n/ar.json'), 'utf8')));
    const usages = scanUsages(
      'Component.tsx',
      await readFile(fixture('i18n/Component.tsx'), 'utf8'),
    );
    const result = evaluateI18n(en, ar, usages);
    const seen = result.violations.map((v) => `${v.rule}:${v.file}`);
    expect(seen).toEqual(
      expect.arrayContaining([
        'catalog-parity:common.onlyEn',
        'catalog-parity:common.onlyAr',
        'icu-syntax:en:common.broken',
        'icu-arguments:common.hello',
        'unresolved-key:Component.tsx',
      ]),
    );
    expect(result.warnings.filter((w) => w.rule === 'dynamic-key')).toEqual([
      {
        rule: 'dynamic-key',
        file: 'Component.tsx',
        message: '2 dynamic key(s) not statically checked',
      },
    ]);
    expect(argumentNames('{count, plural, one {# item} other {# items}} for {name}')).toEqual([
      'count',
      'name',
    ]);
  });
  it('accepts matching catalogs', () => {
    const en = { common: { hello: 'Hello {name}' } };
    expect(
      evaluateI18n(en, { common: { hello: 'مرحبا {name}' } }, [
        { file: 'a', namespace: 'common', key: 'hello' },
      ]).violations,
    ).toEqual([]);
  });
});
describe('audit:portability', () => {
  it('rejects timezone, locale, personal path and denylist literals outside allowed locations', async () => {
    const text = await readFile(fixture('portability/bad.ts'), 'utf8');
    const findings = scanText('src/x.ts', text, parseDenylist('# comment\npersonname\n'));
    expect(findings.map((f) => f.rule).sort()).toEqual([
      'denylist',
      'locale-literal',
      'personal-path',
      'timezone-literal',
    ]);
    expect(scanText('src/x.ts', "redirect('/home')", [])).toEqual([]);
    expect(isScanned('src/core/config/defaults.ts')).toBe(false);
    expect(isScanned('tests/fixtures/timezones.ts')).toBe(false);
    expect(isScanned('src/modules/tasks/service.ts')).toBe(true);
  });
});
describe('audit:migrations', () => {
  const at = (position: number, sql: string) => ({
    position,
    tag: `${String(position - 1).padStart(4, '0')}_fixture`,
    ...classify(sql),
  });
  it('ADMIN-B55 a destructive migration after the baseline must declare whether it breaks rollback', () => {
    const rules = (sql: string) =>
      evaluateMigrations([at(baseline + 1, sql)]).violations.map((finding) => finding.rule);
    expect(rules('ALTER TABLE `tasks` ADD `x` text;')).toEqual([]);
    expect(rules('ALTER TABLE `tasks` DROP COLUMN `x`;')).toEqual(['rollback-compatibility']);
    expect(rules('ALTER TABLE `a` RENAME TO `b`;')).toEqual(['rollback-compatibility']);
    expect(rules('ALTER TABLE `tasks` DROP `x`;')).toEqual(['rollback-compatibility']);
    expect(rules('ALTER TABLE `tasks` RENAME `a` TO `b`;')).toEqual(['rollback-compatibility']);
    expect(rules('ALTER TABLE `tasks` RENAME COLUMN `a` TO `b`;')).toEqual([
      'rollback-compatibility',
    ]);
    expect(rules('-- enan:contract\nDROP TABLE `old`;')).toEqual([]);
    expect(rules('-- enan:compatible rebuild keeps every column\nDROP TABLE `files`;')).toEqual([]);
    expect(rules('-- enan:compatible\nDROP TABLE `files`;')).toEqual(['compatible-reason']);
    // A comment that mentions a statement is not the statement.
    expect(rules('-- we no longer DROP TABLE here\nCREATE TABLE `t` (`id` text);')).toEqual([]);
    // Migrations up to the baseline predate the rule.
    expect(evaluateMigrations([at(baseline, 'DROP TABLE `files`;')]).violations).toEqual([]);
  });
  it('ADMIN-B55 image labels name the schema and the newest migration a rollback cannot cross', () => {
    const migrations = [
      at(1, 'CREATE TABLE `a` (`id` text);'),
      at(2, '-- enan:contract\nDROP TABLE `a`;'),
      at(3, ''),
    ];
    expect(schemaLabels(migrations)).toEqual({ schema: 3, contract: 2 });
    expect(schemaLabels(migrations.slice(0, 1))).toEqual({ schema: 1, contract: 0 });
    // The repository's own history passes, and every migration so far is rollback-compatible.
    const repository = readMigrations(fileURLToPath(new URL('../../..', import.meta.url)));
    expect(evaluateMigrations(repository).violations).toEqual([]);
    expect(schemaLabels(repository).contract).toBe(0);
  });
});
