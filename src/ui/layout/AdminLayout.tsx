'use client';
import { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft, LayoutGrid } from 'lucide-react';
import { cn } from '@/ui/cn';
import { routes, type AdminPage } from '@/core/routes';
import { adminPageOf, adminSections } from './admin-sections';
// ADMIN-B40: on a wide screen the administration pages sit in a grouped list beside the page, so
// every page is one press away and the groups say what each is for. Below `lg` that list would
// wrap into rows that push the page down a phone's height, so it is the overview's job instead
// (ADMIN-B39) and each page carries one link back to it. The list is the views rail of a list page
// (EntityPage, ADR 0031) to the pixel: the same 208 px inset panel, the same place beside the page
// with the same gap and inline-start padding, the same caption over each group and the same rows,
// so moving between a list and the administration the sub-menu neither moves nor changes size. The
// page beside it scrolls on its own, as a list does, opens with its title at the record-title step
// and holds a readable measure.
export function AdminLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('admin');
  const c = useTranslations('common');
  const current = adminPageOf(usePathname());
  return (
    <div className="admin-page px-5 py-8 lg:flex lg:h-full lg:min-h-0 lg:gap-6 lg:p-0 lg:ps-6">
      <AdminNav current={current} />
      {/* The page scrolls on its own from lg, so it is a named region that takes focus: a page of
          plain text (the audit history) would otherwise be a scroll area no keyboard can reach. */}
      <section
        tabIndex={0}
        aria-label={current ? t(current) : c('admin')}
        className="min-w-0 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:flex-1 lg:overflow-y-auto lg:py-8 lg:pe-8"
      >
        {current && (
          <Link
            href={routes.adminHome()}
            className="-ms-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-text-muted hover:text-text lg:hidden"
          >
            <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
            {c('admin')}
          </Link>
        )}
        <h1 className="mb-6 font-display text-title leading-snug font-semibold">
          {current ? t(current) : c('admin')}
        </h1>
        {children}
      </section>
    </div>
  );
}
function AdminNav({ current }: { current: AdminPage | null }) {
  const t = useTranslations('admin');
  const c = useTranslations('common');
  return (
    <nav
      aria-label={c('admin')}
      className="entity-rail my-4 hidden w-[208px] shrink-0 overflow-y-auto rounded-2xl border bg-bg/50 p-2 lg:block"
    >
      <div className="mb-3 grid">
        <NavLink href={routes.adminHome()} active={current === null} icon={LayoutGrid}>
          {t('overview')}
        </NavLink>
      </div>
      <div className="space-y-3">
        {adminSections.map((section) => (
          <div key={section.group}>
            <h2 id={`admin-nav-${section.group}`} className="mb-1 px-3 text-xs text-text-faint">
              {t(section.group)}
            </h2>
            <ul aria-labelledby={`admin-nav-${section.group}`} className="grid gap-0.5">
              {section.pages.map(({ page, icon }) => (
                <li key={page}>
                  <NavLink href={routes.admin(page)} active={current === page} icon={icon}>
                    {t(page)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
// The row of EntityViews: 36 px tall, the main menu's washes, the icon in the accent when current.
function NavLink({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: typeof LayoutGrid;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-9 w-full items-center justify-start gap-2.5 rounded-lg border border-transparent px-3 whitespace-nowrap outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 text-meta font-light text-text-muted transition-colors hover:bg-[var(--nav-hover)] hover:text-text rtl:text-sm',
        active && 'bg-[var(--nav-selected)] text-text hover:bg-[var(--nav-selected)]',
      )}
    >
      <Icon
        className={cn('size-4 shrink-0', active && 'text-accent')}
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-start">{children}</span>
    </Link>
  );
}
