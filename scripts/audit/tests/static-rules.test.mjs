import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { RuleTester } from 'oxlint/plugins-dev';
import eos from '../../../tools/eslint/index.mjs';

const fixtures = JSON.parse(
  await readFile(new URL('./fixtures/static-invalid.json', import.meta.url), 'utf8'),
);

// The rules run the way `pnpm lint` runs them: through Oxlint's ESLint-plugin support, with file
// names relative to the repository root.
RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({
  cwd: fileURLToPath(new URL('../../..', import.meta.url)),
  languageOptions: { sourceType: 'module', parserOptions: { lang: 'tsx' } },
});

function run(rule, valid, invalid) {
  tester.run(`eos/${rule}`, eos.rules[rule], { valid, invalid });
}

describe('WI-0001-M1 static guardrails reject violating fixtures', () => {
  for (const rule of new Set(fixtures.map((fixture) => fixture.rule)))
    run(
      rule,
      [],
      fixtures
        .filter((fixture) => fixture.rule === rule)
        .map(({ code, file = 'src/ui/Example.tsx' }) => ({ code, filename: file, errors: 1 })),
    );
});

describe('WI-0001-M1 static guardrails accept compliant code', () => {
  const translated =
    'const c = <button className="bg-surface text-start ms-2" aria-label={t("action")}>{t("action")}</button>;';
  for (const rule of ['no-color-literals', 'logical-props', 'no-literal-strings'])
    run(rule, [{ code: translated, filename: 'src/ui/Example.tsx' }], []);

  run(
    'effect-sync',
    [{ code: '// sync: browser focus\nuseEffect(() => subscribe(), []);', filename: 'src/ui/Example.tsx' }],
    [],
  );

  const cast = 'const row = value as Row; // cast: database adapter has validated the row';
  run(
    'cast-comments',
    [{ code: cast, filename: 'src/core/db/adapter.ts' }],
    [{ code: cast, filename: 'src/ui/Example.tsx', errors: 1 }],
  );

  run('environment', [{ code: 'const raw = process.env;', filename: 'src/core/config/env.ts' }], []);
});
