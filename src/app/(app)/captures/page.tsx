import { redirect } from 'next/navigation';
import { currentUser } from '@/core/auth/session';
import { readOnlyDb } from '@/core/db/client';
import { id } from '@/core/db/ids';
import { routes } from '@/core/routes';
import { listCaptures } from '@/modules/captures';
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
  const query = CaptureListQuery.parse({
    scope: (await searchParams).scope === 'all' ? 'all' : 'mine',
  });
  const initial = await listCaptures({ db: readOnlyDb(), user, requestId: id() }, query);
  return (
    <PageBody>
      <CapturesPage initial={initial} scope={query.scope} admin={user.role === 'admin'} />
    </PageBody>
  );
}
