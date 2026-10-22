// The only place application URLs are spelled out. Client-safe; used by pages, links and services.
type Query = Record<string, string | null | undefined>;
type Optional<K extends string> = Partial<Record<K, string | null | undefined>>;
function withQuery(path: string, query: Query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : path;
}
export type AdminPage =
  | 'users'
  | 'settings'
  | 'tasks'
  | 'notes'
  | 'objectives'
  | 'ai'
  | 'mail'
  | 'signin'
  | 'backups'
  | 'updates'
  | 'jobs'
  | 'audit';
export const routes = {
  committees: (query?: Optional<'view' | 'id' | 'scope'>) => withQuery('/committees', query),
  root: () => '/',
  home: () => '/home',
  kpis: (query?: Optional<'view' | 'id' | 'objectiveId' | 'category' | 'team' | 'sort'>) =>
    withQuery('/kpis', query),
  tasks: (query?: Optional<'view' | 'id' | 'ownerId' | 'sort' | 'committeeId' | 'due' | 'new'>) =>
    withQuery('/tasks', query),
  people: (query?: Optional<'view' | 'id'>) => withQuery('/people', query),
  notes: (query?: Optional<'view' | 'id' | 'personId' | 'tag' | 'type' | 'committeeId'>) =>
    withQuery('/notes', query),
  person: (personId: string) => withQuery('/people', { id: personId }),
  adminHome: () => '/admin',
  admin: (page: AdminPage) => `/admin/${page}`,
  account: () => '/account',
  login: () => '/login',
  setup: () => '/setup',
  recovery: () => '/recovery',
  loginCode: () => '/login/code',
};
