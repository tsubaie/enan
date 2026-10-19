import { NoteTemplatesAdmin, NoteTypesAdmin, TagsAdmin } from '@/modules/notes/ui';
import { PageBody } from '@/ui/layout/PageTransition';
export default function Page() {
  return (
    <PageBody>
      <div className="space-y-12">
        <NoteTypesAdmin />
        <NoteTemplatesAdmin />
        <TagsAdmin />
      </div>
    </PageBody>
  );
}
