import { z } from 'zod';
import { tablesOf, type ImportTarget, type Row } from '../../src/core/db/postgres-import';
import { searchCorpus } from '../../src/core/search/normalize';
import * as committees from '../../src/modules/committees/schema/db';
import * as kpis from '../../src/modules/kpis/schema/db';
import * as notes from '../../src/modules/notes/schema/db';
import * as people from '../../src/modules/people/schema/db';
import * as tasks from '../../src/modules/tasks/schema/db';
// The module tables and search corpora scripts/db/import-postgres.ts imports into (core holds the
// system tables and does not reach into modules). The corpora are the ones the repos write (each
// module's corpusOf); keep them in step.
const text = z.string().nullish();
const corpus: ImportTarget['corpus'] = {
  tasks: (r: Row) => searchCorpus(z.string().parse(r.title), text.parse(r.description)),
  notes: (r: Row) =>
    searchCorpus(
      z.string().parse(r.title),
      text.parse(r.content),
      ...(z.array(z.string()).nullish().parse(r.tags) ?? []),
    ),
  people: (r: Row) =>
    searchCorpus(
      z.string().parse(r.fullName),
      text.parse(r.displayName),
      text.parse(r.organization),
      text.parse(r.roleTitle),
      text.parse(r.email),
    ),
  committees: (r: Row) =>
    searchCorpus(z.string().parse(r.name), text.parse(r.description), text.parse(r.ownership)),
  kpis: (r: Row) =>
    searchCorpus(z.string().parse(r.name), text.parse(r.category), text.parse(r.notes)),
};
export function moduleTargets(): ImportTarget {
  return { tables: tablesOf(committees, kpis, notes, people, tasks), corpus };
}
