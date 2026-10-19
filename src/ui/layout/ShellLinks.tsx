'use client';
import { IntentLink } from '@/ui/layout/IntentLink';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { navigation } from '@/core/modules/client';
import { cn } from '@/ui/cn';
type Scope = 'all' | 'primary' | 'admin';
// ADMIN-B19: the shell renders the same entries in three places. `scope` picks which of them:
// the sidebar carries the everyday modules at the top and the administration entry at its foot,
// while the mobile bar carries every entry it is given.
export function ShellLinks({ role, scope = 'all' }: { role: string; scope?: Scope }) {
  const t = useTranslations('common');
  const path = usePathname();
  const links = navigation(role)
    .filter((item) => scope === 'all' || item.admin === (scope === 'admin'))
    .map((item) => {
      const Icon = item.icon;
      const Badge = item.badge;
      const key = item.key;
      const current = path.startsWith(item.href.split('/').slice(0, 2).join('/'));
      return (
        <IntentLink
          key={item.href}
          href={item.href}
          aria-current={current ? 'page' : undefined}
          className={cn(
            'group/nav flex h-11 items-center gap-3.5 rounded-xl px-3 text-sm font-light text-text-muted transition-colors duration-150 hover:bg-[var(--nav-hover)] hover:text-text aria-[current=page]:bg-[var(--nav-selected)] aria-[current=page]:font-normal aria-[current=page]:text-text rtl:text-nav',
          )}
        >
          <Icon
            className="size-[19px] shrink-0 group-aria-[current=page]/nav:text-accent"
            strokeWidth={1.75}
            aria-hidden={true}
          />
          {/* The mobile bar lays each entry out as a column (tokens.css), where a growing label
              would stretch instead of sitting beside the icon; only the rail needs it to grow. */}
          <span className={cn('min-w-0 truncate', scope !== 'all' && 'flex-1')}>{t(key)}</span>
          {Badge && scope !== 'all' && <Badge />}
        </IntentLink>
      );
    });
  return <>{links}</>;
}
