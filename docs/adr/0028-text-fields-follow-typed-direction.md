# ADR 0028 — Text fields take their direction from what is typed, and a text area from its first letter

**Status:** accepted (2026-09-30)

## Context

`05-ui-guidelines.md` required `dir="auto"` on inputs, but each call site had to remember it. About half did, so in the Arabic interface an English title typed into a field without it ran right to left, and the reverse in English. Search boxes, tag fields, new-task titles, admin labels and the user forms had no `dir` at all.

Two browser behaviours also work against a plain `dir="auto"`:

- An empty `dir="auto"` field resolves to left to right, not to its parent's direction. Put on every field, that would place the caret of every empty field on the left in the Arabic interface.
- The user-agent stylesheet gives `textarea[dir=auto]` `unicode-bidi: plaintext`, so each line of a text area finds its own direction. A line with no letter — the empty line after Enter, a markdown list marker, a row of figures — falls back to left to right. In an Arabic note the caret jumped to the left on every new line.

## Decision

- The `Input`, `Textarea` and `ComboboxSearch` primitives own the direction of typed text (EP-B45). Call sites do not set `dir` unless the field's script is fixed (a password, an address, a label kept in one language); a pinned `dir` is passed through and nothing is tracked.
- A field with text carries `dir="auto"`. An empty field carries no `dir` and inherits the interface's direction. The primitives switch between the two on `input` events and after every render, since a controlled value or a form reset changes the text without an input event (`src/ui/primitives/typed-direction.ts`). The attribute is set on the element directly, so it never causes a render.
- A text area keeps every line on the side of its first letter: `textarea[dir='auto']` gets `unicode-bidi: isolate` in `tokens.css`.

## Consequences

- Every new field gets the behaviour without doing anything; `dir="auto"` on a field is now redundant and was removed from 17 files.
- While a text area is being edited, a note that opens in English and continues with an Arabic paragraph shows that paragraph aligned to the left. The Arabic words themselves still read right to left, and the rendered note (ADR 0015) still lays each block out on its own side.
- jsdom does not run the bidi algorithm, so the component suite checks the attribute; the resolved direction and the text area's line behaviour are checked in the browser suite.

## Alternatives considered

- **`dir="auto"` everywhere, empty fields included.** Simplest, but it puts the caret on the left of every empty field in the Arabic interface. Rejected.
- **Keep per-paragraph direction in text areas.** Each paragraph is laid out on its own side, but every line without a letter falls to the left, including the one the writer is about to type on. Writing matters more in the editor than a mixed paragraph's alignment, and the rendered view already handles mixed paragraphs. Rejected.
- **Set the text area's direction from the line the caret is on.** Follows the writer in mixed notes, but every other line would realign as the caret moves between paragraphs. Rejected.
- **Guess the language from the keyboard layout (`navigator.keyboard.getLayoutMap`).** Chromium-only, needs a secure context, and reports the layout map rather than the active input language. Rejected.
