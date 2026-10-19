import 'server-only';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { likePattern, prefixPattern } from '@/core/search/merge';
// ADR 0021 / ADR 0029: the corpus is the `search_text` column each searchable table carries,
// written by its repo as `normalize(name) + '\n' + normalize(rest…)`. These two build the
// predicate and the rank against it so that five repos express the same match the same way; the
// queries themselves stay in each module's repo, which is where the module's own visibility lives.
// SQLite's LIKE has no default escape character, so the backslash likePattern uses is declared.
export function searchMatch(corpus: SQLWrapper, normalized: string): SQL {
  return sql`${corpus} like ${likePattern(normalized)} escape '\\'`;
}
// SEARCH-B03: 0 when the record's name starts with what was typed, 1 for a match anywhere. The
// corpus begins with the normalised name and a newline follows it, so a prefix of the corpus is a
// prefix of the name: pass the `search_text` column here, not the name column.
export function searchRank(corpus: SQLWrapper, normalized: string): SQL<0 | 1> {
  return sql<
    0 | 1
  >`case when ${corpus} like ${prefixPattern(normalized)} escape '\\' then 0 else 1 end`;
}
