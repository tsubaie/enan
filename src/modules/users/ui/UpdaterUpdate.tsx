'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpCircle } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { type Status, type useCommand } from './update-queries';
import { Code, commands, Panel } from './update-parts';

// ADMIN-B74, ADR 0062: a newer updater, installed with one press. Enan's request makes the updater
// start the new one from a helper, check that it runs and keep the current one if it does not. An
// updater from before it could replace itself gets the server commands, once.
export function UpdaterUpdate({
  status,
  command,
  enabled,
}: {
  status: Status;
  command: ReturnType<typeof useCommand>;
  enabled: boolean;
}) {
  const t = useTranslations('admin');
  // Kept once pressed, so the card stays to say how it went after the newer updater is the current.
  const [asked, setAsked] = useState(false);
  // ADMIN-B75: from protocol 3, Install now covers the updater too, in the one card.
  if ((!status.updaterUpdate && !asked) || (status.protocol >= 3 && !asked)) return null;
  if (status.protocol < 2 || !enabled) return <FromTheServer />;
  const answer = asked ? answerOf(status, command.isPending) : null;
  return (
    <Panel title={t('updaterUpdateAvailable')}>
      <p className="mb-2 text-sm leading-relaxed font-light text-text-muted">
        {t('updaterUpdateHelp')}
      </p>
      {status.automatic && (
        <p className="mb-3 text-sm font-light text-text-muted">{t('updaterUpdateAutomatic')}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {status.updaterUpdate && (
          <Button
            disabled={answer === 'updaterUpdating'}
            onClick={() => {
              setAsked(true);
              command.mutate({ command: 'update_updater' });
            }}
          >
            <ArrowUpCircle className="size-4" aria-hidden />
            {t('updaterUpdateNow')}
          </Button>
        )}
        {answer && (
          <p
            role="status"
            aria-busy={answer === 'updaterUpdating'}
            className="text-sm text-text-muted"
          >
            {t(answer)}
          </p>
        )}
      </div>
    </Panel>
  );
}
// What came of the press: under way until the updater's status says otherwise, then kept or not.
function answerOf(status: Status, pending: boolean) {
  if (status.state === 'failed' && status.step === 'updater') return 'updaterUpdateFailed';
  if (!pending && !status.updaterUpdate) return 'updaterUpdated';
  return 'updaterUpdating';
}
function FromTheServer() {
  const t = useTranslations('admin');
  return (
    <Panel title={t('updaterUpdateAvailable')}>
      <p className="mb-3 text-sm font-light text-text-muted">{t('updaterUpdateOld')}</p>
      <Code>{commands.replaceUpdater}</Code>
    </Panel>
  );
}
