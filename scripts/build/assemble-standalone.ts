import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { exists } from '../audit/lib/files';
// Next's standalone output expects static assets and public files next to server.js. The
// migrations folder goes there too: server.js changes into its own directory, and the migrator
// reads `./drizzle` from it (the image lays /app out the same way).
const root = process.cwd();
const standalone = join(root, '.next/standalone');
// The commands the container runs besides the server, bundled into plain JavaScript so the image
// needs neither tsx nor the source tree. Packages the standalone output already keeps in its
// node_modules (native addons, and pino, which starts workers from its own files) stay external;
// everything else is inlined. react-server resolves `server-only` the way the server does.
const commands = {
  'db:migrate': 'scripts/db/migrate.ts',
  'backup:create': 'scripts/backup/create.ts',
  'backup:restore': 'scripts/backup/restore.ts',
};
const external = ['argon2', '@libsql/client', 'pino', 'sharp'];

async function bundleCommands() {
  const scripts: Record<string, string> = { start: 'node server.js' };
  for (const [name, entry] of Object.entries(commands)) {
    const outfile = `commands/${name.replace(':', '-')}.mjs`;
    await build({
      entryPoints: [join(root, entry)],
      outfile: join(standalone, outfile),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      conditions: ['react-server'],
      external,
      // Bundled CommonJS dependencies still call require().
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      logLevel: 'warning',
    });
    scripts[name] = `node ${outfile}`;
  }
  // `pnpm backup:create` and the other commands keep working inside the container (ADMIN-B13).
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const runtime = { name: pkg.name, version: pkg.version, private: true, type: pkg.type };
  await writeFile(
    join(standalone, 'package.json'),
    JSON.stringify({ ...runtime, packageManager: pkg.packageManager, scripts }, null, 2) + '\n',
  );
}

if (await exists(standalone)) {
  await cp(join(root, '.next/static'), join(standalone, '.next/static'), { recursive: true });
  if (await exists(join(root, 'public')))
    await cp(join(root, 'public'), join(standalone, 'public'), { recursive: true });
  await cp(join(root, 'drizzle'), join(standalone, 'drizzle'), { recursive: true });
  await bundleCommands();
}
