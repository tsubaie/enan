// Entering the preview with a click should put the caret where the click landed (notes.md § UI).
// The rendered text under the pointer is looked up in the markdown source: rendered text nodes
// are substrings of the source in almost every case (markup only surrounds them), so the nth
// rendered occurrence of that text maps to the nth occurrence in the source.
export function sourceOffset(
  source: string,
  texts: readonly string[],
  index: number,
  offset: number,
): number | null {
  const text = texts[index];
  if (text === undefined) return null;
  const needle = text.trim() ? text : null;
  if (!needle) return null;
  const nth = texts.slice(0, index).filter((other) => other === text).length;
  let from = 0;
  for (let seen = 0; ; seen++) {
    const at = source.indexOf(needle, from);
    if (at < 0) return null;
    if (seen === nth) return Math.min(source.length, at + offset);
    from = at + needle.length;
  }
}
function textNodes(root: Node) {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node instanceof Text) nodes.push(node);
  return nodes;
}
type CaretPoint = { offsetNode: Node; offset: number };
type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => CaretPoint | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};
// The source position for a pointer position inside `root`, or null when the browser cannot
// resolve a caret there (a click on padding, or an older engine).
function caretAt(x: number, y: number): CaretPoint | null {
  const doc: CaretDocument = document;
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) return position;
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { offsetNode: range.startContainer, offset: range.startOffset } : null;
}
export function sourceOffsetFromPoint(root: HTMLElement, x: number, y: number, source: string) {
  const hit = caretAt(x, y);
  if (!hit || !(hit.offsetNode instanceof Text) || !root.contains(hit.offsetNode)) return null;
  const nodes = textNodes(root);
  return sourceOffset(
    source,
    nodes.map((item) => item.data),
    nodes.indexOf(hit.offsetNode),
    hit.offset,
  );
}
// Where a character of a textarea's text is drawn, relative to the textarea's own box: the mirror
// technique, a hidden copy with the same box and type that lays the text out the same way, with
// the character wrapped so its line box can be read. Scrolled text is accounted for.
const MIRRORED = [
  'box-sizing',
  'width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'line-height',
  'text-transform',
  'word-spacing',
  'tab-size',
  'direction',
  'text-align',
];
export function characterBox(textarea: HTMLTextAreaElement, index: number) {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const property of MIRRORED)
    mirror.style.setProperty(property, style.getPropertyValue(property));
  mirror.style.setProperty('position', 'absolute');
  mirror.style.setProperty('visibility', 'hidden');
  mirror.style.setProperty('white-space', 'pre-wrap');
  mirror.style.setProperty('overflow-wrap', 'break-word');
  mirror.style.setProperty('top', '0');
  mirror.style.setProperty('left', '-99999px');
  mirror.textContent = textarea.value.slice(0, index);
  const mark = document.createElement('span');
  mark.textContent = textarea.value[index] ?? '@';
  mirror.append(mark);
  document.body.append(mirror);
  const box = {
    top: mark.offsetTop - textarea.scrollTop,
    left: mark.offsetLeft,
    right: mark.offsetLeft + mark.offsetWidth,
    height: mark.offsetHeight,
    rtl: style.direction === 'rtl',
  };
  mirror.remove();
  return box;
}
