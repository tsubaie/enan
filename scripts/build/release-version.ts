// ADMIN-B54, ADR 0056: calendar versions, YYYY.M.N. Dependency-free, so the release workflows run
// it with plain Node:
//   git tag -l 'v*' | node scripts/build/release-version.ts next <commits since the last release>
//   node scripts/build/release-version.ts check v2026.10.0
import { readFileSync } from 'node:fs';

const calendar = /^v?(\d{4})\.([1-9]|1[0-2])\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/u;

// The version a tag names, or null when it is not a calendar version (`v0.1.0`, `v2026.01.0`).
export function parseReleaseTag(
  tag: string,
): { year: number; month: number; n: number; prerelease: boolean } | null {
  const match = calendar.exec(tag.trim());
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    n: Number(match[3]),
    prerelease: match[4] !== undefined,
  };
}

// The next release's version for this month (UTC), or null when nothing merged since the last one.
export function nextVersion(now: Date, tags: string[], commitsSinceLast: number): string | null {
  if (commitsSinceLast <= 0) return null;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const counters = tags.flatMap((tag) => {
    const v = parseReleaseTag(tag);
    return v && !v.prerelease && v.year === year && v.month === month ? [v.n] : [];
  });
  const n = counters.length === 0 ? 0 : Math.max(...counters) + 1;
  return `${year}.${month}.${n}`;
}

if (process.argv[1]?.endsWith('release-version.ts')) {
  const [command, argument = ''] = process.argv.slice(2);
  if (command === 'next') {
    const tags = readFileSync(0, 'utf8').split('\n').filter(Boolean);
    const version = nextVersion(new Date(), tags, Number(argument));
    if (version) process.stdout.write(`${version}\n`);
  } else if (command === 'check') {
    if (!parseReleaseTag(argument)) {
      process.stderr.write(
        `${argument} is not vYYYY.M.N (month and counter without a leading zero)\n`,
      );
      process.exit(1);
    }
  } else {
    process.stderr.write('usage: release-version.ts next <commits> | check <tag>\n');
    process.exit(2);
  }
}
