import { z } from 'zod';

// ADMIN-B72: the kinds of entry the audit log can be narrowed to, and the records each one covers.
// Shared by the API, which filters on them, and the page, which offers them.
export const AuditType = z.enum([
  'sign_in',
  'tasks',
  'notes',
  'people',
  'committees',
  'kpis',
  'users',
  'settings',
  'ai',
  'maintenance',
]);
export type AuditType = z.infer<typeof AuditType>;
export const auditTypeEntities: Record<AuditType, string[]> = {
  sign_in: ['session'],
  tasks: ['task'],
  notes: ['note', 'tag'],
  people: ['person'],
  committees: ['committee'],
  kpis: ['kpi', 'objective', 'kpi_reading', 'kpi_target', 'kpi_targets'],
  users: ['user'],
  settings: ['setting', 'wallpaper', 'mail_settings', 'google_settings'],
  // `settings` (plural) is the AI controls and models; the workspace's own are `setting`.
  ai: ['settings', 'ai_credentials', 'jobs'],
  maintenance: ['backup', 'trash', 'updater'],
};

// ADMIN-B73: what an entry did, by the words in its action, checked in this order: a removal
// first ("mail.settings.remove" is one, though "settings" holds "set"), then an addition, then a
// change. The audit page colours entries by the same words, so the filter and the colours agree.
export const AuditChange = z.enum(['removed', 'added', 'changed']);
export type AuditChange = z.infer<typeof AuditChange>;
export const changeWords: Record<AuditChange, string[]> = {
  removed: ['delete', 'remove', 'purge'],
  added: ['create', 'add'],
  changed: [
    'update',
    'edit',
    'save',
    'set',
    'reorder',
    'move',
    'restore',
    'archive',
    'undo',
    'reopen',
    'complete',
    'merge',
    // account.password_changed, account.email_changed, account.renamed
    'changed',
    'renamed',
  ],
};
export function changeOf(action: string): AuditChange | null {
  return (
    AuditChange.options.find((change) =>
      changeWords[change].some((word) => action.includes(word)),
    ) ?? null
  );
}
