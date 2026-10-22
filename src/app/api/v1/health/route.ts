import { db } from '@/core/db/client';
import { initialized } from '@/core/db/auth-repo';
import { jobsHealth } from '@/core/db/jobs-repo';
import { storageUsage } from '@/core/files/storage';
import { aiConnection } from '@/core/ai/client';
import { env } from '@/core/config/env';
import { isRestoring } from '@/core/backup/maintenance';
import { appVersion } from '@/core/config/version';
import { currentUser } from '@/core/auth/session';
export async function GET() {
  try {
    await initialized(db());
    const health = {
      status: (await isRestoring()) ? 'degraded' : 'ok',
      version: appVersion,
      // ADMIN-B54: an updater confirms the new container, not an old one, is the one answering.
      // Kept public: updaters already installed verify every new image by it.
      revision: env().ENAN_REVISION ?? null,
      db: true,
    };
    const headers = { 'Cache-Control': 'no-store' };
    // The route is public; how the install is configured and loaded is for its administrators.
    if ((await currentUser({ slide: false }))?.role !== 'admin')
      return Response.json(health, { headers });
    const counts = await jobsHealth();
    const queued = counts.find((row) => row.status === 'queued');
    return Response.json(
      {
        ...health,
        ai: aiConnection().state,
        jobs: {
          queued: queued?.count ?? 0,
          running: counts.find((row) => row.status === 'running')?.count ?? 0,
          oldestQueuedSeconds: queued?.oldest
            ? Math.max(0, (Date.now() - new Date(queued.oldest).getTime()) / 1000)
            : 0,
        },
        storage: { usedBytes: await storageUsage(), quotaBytes: env().FILES_QUOTA_GB * 1024 ** 3 },
      },
      { headers },
    );
  } catch {
    return Response.json({ status: 'degraded', db: false }, { status: 503 });
  }
}
