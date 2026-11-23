import { redirect } from 'next/navigation';
import { z } from 'zod';
import { currentUser } from '@/core/auth/session';
import { readOnlyDb } from '@/core/db/client';
import { id } from '@/core/db/ids';
import { routes } from '@/core/routes';
import { listCaptures, readerCapture } from '@/modules/captures';
import { CaptureListQuery } from '@/modules/captures/schema/validation';
import { CapturesPage } from '@/modules/captures/ui/CapturesPage';
import { PageBody } from '@/ui/layout/PageTransition';
// The review inbox (CAPTURES-B02): read on the server for the signed-in reader, inside the same
// visibility predicate as the API, and handed to the client islands as their first data.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect(routes.login());
  const params = await searchParams;
  const query = CaptureListQuery.parse({ scope: params.scope === 'all' ? 'all' : 'mine' });
  // CAPTURES-B21: a failed recording's bell line opens the inbox on it.
  const focus = z.uuid().safeParse(params.capture).data ?? null;
  const [initial, capture] = await Promise.all([
    listCaptures({ db: readOnlyDb(), user, requestId: id() }, query),
    readerCapture(user.id),
  ]);
  return (
    <PageBody>
      <CapturesPage
        initial={initial}
        scope={query.scope}
        admin={user.role === 'admin'}
        capture={capture}
        focus={focus}
      />
    </PageBody>
  );
}
