import { execFileSync } from 'node:child_process';
import { currentLane, laneEnv } from '../lanes';
// The interpreter's stand-in for the browser suite, where AI is off: two drafts on the capture,
// written on the current lane's database by scripts/db/e2e-capture-drafts.ts.
export function seedDrafts(captureId: string) {
  execFileSync(
    process.execPath,
    ['--conditions=react-server', '--import', 'tsx', 'scripts/db/e2e-capture-drafts.ts'],
    { stdio: 'inherit', env: { ...process.env, ...laneEnv(currentLane()), CAPTURE_ID: captureId } },
  );
}
