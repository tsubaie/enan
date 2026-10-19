import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// A private directory per test for a database file the test creates, and its removal.
export function scratchDirectory(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    path: (name: string) => join(dir, name),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}
