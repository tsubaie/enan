'use client';
import { type ReactNode } from 'react';
import Link from 'next/link';
import { ShellLinks } from './ShellLinks';
import { MobileNav } from './MobileNav';
import { Logo } from './Logo';
import { ShellHeader } from './ShellHeader';
import { routes } from '@/core/routes';
type ShellUser = { id: string; name: string; email: string; role: string };
export function AppShell({
  children,
  user,
  workspace,
}: {
  children: ReactNode;
  user: ShellUser;
  workspace: string;
}) {
  return (
    // The shell owns the viewport: it is exactly one screen tall and the page scrolls inside its own
    // column, under a header and over a bottom bar that each hold their size. Nothing depends on
    // either of those heights being written down a second time in CSS, which is what left a strip of
    // empty ground under the page — and, on a phone, a control under the navigation bar.
    // ADR 0031: from 1024 px the menu and the page are two panels inset from the window. The menu
    // floats in the navigation layer as glass; the page is the content layer under it, a thick
    // material (Apple: glass is for navigation, never for content, and never glass on glass).
    <div className="flex h-dvh flex-col overflow-hidden bg-bg lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <Sidebar user={user} workspace={workspace} />
      <div className="app-canvas flex min-h-0 min-w-0 flex-1 flex-col bg-surface lg:m-2 lg:overflow-hidden lg:rounded-2xl lg:border">
        <ShellHeader user={user} />
        {/* Below 1024 px the bar floats over this column as a glass capsule, so the page reserves
            the ground it takes — the safe area, the gap under the capsule, the capsule and the gap
            over it (--mobile-nav-clear in tokens.css) — rather than running its last rows under it. */}
        <main
          id="content"
          className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-[var(--mobile-nav-clear)] lg:pb-0"
        >
          {children}
        </main>
      </div>
      <nav className="mobile-navigation fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+var(--mobile-nav-gap))] z-30 flex gap-0.5 rounded-[28px] border p-1 lg:hidden">
        <MobileNav role={user.role} />
      </nav>
    </div>
  );
}

function Sidebar({ user, workspace }: { user: ShellUser; workspace: string }) {
  return (
    <aside className="app-sidebar hidden min-h-0 flex-col overflow-y-auto px-2 py-3 lg:my-2 lg:ms-2 lg:flex lg:rounded-[20px] lg:border">
      {/* ADR 0030: the mark sits in an accent-tinted square and the name in the display face; the
          two together are the only brand on the page. The name is the workspace's own
          (workspace.name), so the office sees itself here rather than the product. */}
      <Link
        href={routes.home()}
        title={workspace}
        className="mb-8 flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 font-display text-brand"
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent ring-1 ring-accent/25 ring-inset">
          <Logo className="size-[22px]" />
        </span>
        <span dir="auto" className="min-w-0 truncate">
          {workspace}
        </span>
      </Link>
      <nav className="space-y-0.5">
        <ShellLinks role={user.role} scope="primary" />
      </nav>
      {/* ADMIN-B19: administration is reached from the account menu in the header, and the reader's
          name lives there too, so the rail carries the destinations alone. */}
    </aside>
  );
}
