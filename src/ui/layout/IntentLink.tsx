'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps, FocusEvent, MouseEvent, TouchEvent } from 'react';
// ExecutiveOS#79: a link that loads its page only when the reader shows intent: a pointer over it, focus on
// it, or a finger on it. Next's default prefetches every link as it enters the viewport, so a page
// of links (the menu, Home's sections and rows) set off fifteen or more page loads at once, twice
// each, and on a slow connection they queued in front of the navigation the reader actually made.
// Intent still arrives a few hundred milliseconds before the click, which is most of the benefit.
export function IntentLink({
  href,
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href' | 'prefetch'> & { href: string }) {
  const router = useRouter();
  const intend = () => router.prefetch(href);
  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onMouseEnter={(event: MouseEvent<HTMLAnchorElement>) => {
        intend();
        onMouseEnter?.(event);
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        intend();
        onFocus?.(event);
      }}
      onTouchStart={(event: TouchEvent<HTMLAnchorElement>) => {
        intend();
        onTouchStart?.(event);
      }}
    />
  );
}
