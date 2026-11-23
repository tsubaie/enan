'use client';
// Focus is lost when nothing holds it (the page itself) or it sits in a toast, whose controls go
// away with it (an Undo that turns into a dismiss). A focus move made on the reader's behalf after
// something closed or came back runs only then, so it never takes focus from where they put it.
export function focusWasLost() {
  const active = document.activeElement;
  return (
    !active || active === document.body || Boolean(active.closest("[data-slot='toast-viewport']"))
  );
}
