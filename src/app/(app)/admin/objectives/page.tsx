import { ObjectivesAdmin } from '@/modules/kpis/ui';
import { KpiStatusSettings } from '@/modules/settings/ui';
import { PageBody } from '@/ui/layout/PageTransition';
export default function Page() {
  return (
    <PageBody>
      <div className="grid gap-4">
        <ObjectivesAdmin />
        <KpiStatusSettings />
      </div>
    </PageBody>
  );
}
