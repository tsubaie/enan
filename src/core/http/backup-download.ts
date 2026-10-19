import 'server-only';
import { z } from 'zod';
import { currentUser } from '@/core/auth/session';
import { backupArchive } from '@/core/backup/dump';
import { db } from '@/core/db/client';
import { writeAudit } from '@/core/db/audit-repo';
// ADMIN-B44: an administrator downloads one backup as a .tar file. It is a file, not JSON, so it is
// served here rather than through defineHandler, with the same guards: a session, the admin role,
// and an id that names a backup that still verifies. The download is written to the audit log.
export async function backupDownload(
  _request: Request,
  route: { params: Promise<Record<string, string>> },
) {
  const user = await currentUser({ slide: true });
  if (!user) return Response.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  if (user.role !== 'admin')
    return Response.json({ error: { code: 'forbidden' } }, { status: 403 });
  const id = z.uuid().safeParse((await route.params).id);
  if (!id.success) return Response.json({ error: { code: 'not_found' } }, { status: 404 });
  let archive: Awaited<ReturnType<typeof backupArchive>>;
  try {
    archive = await backupArchive(id.data);
  } catch {
    return Response.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  await writeAudit(db(), user.id, 'download', 'backup', id.data, {});
  const day = archive.manifest.createdAt.slice(0, 10);
  // The archive is read as the response is sent, one chunk at a time.
  const chunks = archive.stream[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(new Uint8Array(next.value));
    },
    async cancel() {
      await chunks.return?.();
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-tar',
      'Content-Disposition': `attachment; filename="executiveos-backup-${day}.tar"`,
      'Cache-Control': 'no-store',
    },
  });
}
