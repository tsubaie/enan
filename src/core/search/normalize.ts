// The port of the PostgreSQL `eos_normalize` function (ADR 0029): lower case, the Arabic range
// U+064B–U+0670 (tashkeel marks and what the old character class `[ً-ٰٟـ]` spanned between them)
// and the tatweel U+0640 removed, the alef forms folded onto bare alef and alef maqsura onto
// yeh. NFKC first, so presentation forms and compatibility characters fold the same way on the
// stored corpus and on the query, which both pass through here (SEARCH-B01).
export function normalize(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064b-\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي');
}
// The `search_text` a repo writes on every insert and update: the normalised name first, then a
// newline, then the other fields normalised and joined with one space (nulls skipped). The
// newline is what lets `searchRank` treat a prefix of the corpus as a prefix of the name.
export function searchCorpus(name: string, ...rest: (string | null | undefined)[]) {
  const body = rest.filter((part): part is string => typeof part === 'string' && part !== '');
  return `${normalize(name)}\n${body.map(normalize).join(' ')}`;
}
