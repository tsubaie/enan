import 'server-only';
import { z } from 'zod';
/**
 * Constraint failures as SQLite reports them (ADR 0029), read once here so module repos map the
 * same way. Drizzle wraps the driver failure (`DrizzleQueryError`, cause = `LibsqlError`), libsql
 * wraps the native one (`LibsqlError`, cause = `SqliteError`): the generic `code` is
 * `SQLITE_CONSTRAINT` at the libsql layer and only the native layer carries the extended name,
 * so the extended *numeric* result code (`rawCode`, present on both) is what is classified. The
 * message is the native text, `UNIQUE constraint failed: tasks.a, tasks.b`,
 * `CHECK constraint failed: <name>`, `FOREIGN KEY constraint failed`, or, for a trigger's
 * `RAISE(ABORT, …)`, the raised text itself (`TASKS-I01 depth one required`).
 */
export type ConstraintKind = 'unique' | 'foreign_key' | 'check' | 'not_null' | 'trigger' | 'other';
export type ConstraintViolation = {
  kind: ConstraintKind;
  // The text after the `<KIND> constraint failed: ` prefix, or the raised message of a trigger.
  message: string;
  // `table.column` names for unique and not-null failures; empty otherwise.
  columns: string[];
  // The CHECK constraint's name (SQLite reports the name of a named CHECK) or the trigger's
  // raised text; null for the kinds that carry neither.
  constraint: string | null;
};
// SQLite extended result codes (https://www.sqlite.org/rescode.html).
const kinds: Record<number, ConstraintKind> = {
  275: 'check',
  787: 'foreign_key',
  1299: 'not_null',
  1555: 'unique', // SQLITE_CONSTRAINT_PRIMARYKEY
  1811: 'trigger',
  2067: 'unique',
};
const Coded = z.object({
  rawCode: z.number().int().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
const constraintPrefix =
  /^(?:SQLITE_CONSTRAINT(?:_[A-Z]+)?: )?(?:(UNIQUE|CHECK|FOREIGN KEY|NOT NULL) constraint failed(?:: )?)?/u;
function describe(rawCode: number | undefined, code: string, raw: string): ConstraintViolation {
  const kind = (rawCode !== undefined && kinds[rawCode]) || 'other';
  const message = raw.replace(constraintPrefix, '').trim();
  const columns =
    kind === 'unique' || kind === 'not_null'
      ? message
          .split(',')
          .map((column) => column.trim())
          .filter(Boolean)
      : [];
  const constraint = kind === 'check' || kind === 'trigger' ? message || code : null;
  return { kind, message, columns, constraint };
}
// Walks the cause chain for the first error that carries a SQLite constraint code.
export function constraintViolation(error: unknown): ConstraintViolation | null {
  if (!(error instanceof Error)) return null;
  for (let current: Error | undefined = error; current; current = causeOf(current)) {
    const coded = Coded.safeParse(current);
    if (!coded.success) continue;
    const { rawCode, code = '', message = '' } = coded.data;
    const constraint =
      code.startsWith('SQLITE_CONSTRAINT') || (rawCode !== undefined && rawCode in kinds);
    if (constraint) return describe(rawCode, code, message);
  }
  return null;
}
function causeOf(error: Error) {
  return error.cause instanceof Error ? error.cause : undefined;
}
// A unique (or primary key) failure; with columns, only one on exactly that set, in any order,
// so a repo can tell its unique indexes apart (SQLite names the columns, never the index).
export function isUniqueViolation(error: unknown, columns?: readonly string[]) {
  const violation = error instanceof Error ? constraintViolation(error) : null;
  if (violation?.kind !== 'unique') return false;
  if (!columns) return true;
  const actual = [...violation.columns].sort();
  const expected = [...columns].sort();
  return actual.length === expected.length && actual.every((name, i) => name === expected[i]);
}
export function isForeignKeyViolation(error: unknown) {
  return error instanceof Error && constraintViolation(error)?.kind === 'foreign_key';
}
// A CHECK by its declared name, e.g. `isCheckViolation(error, 'notes_tags_check')`.
export function isCheckViolation(error: unknown, name?: string) {
  const violation = error instanceof Error ? constraintViolation(error) : null;
  if (violation?.kind !== 'check') return false;
  return name === undefined || violation.constraint === name;
}
// A trigger's RAISE, matched on the start of the raised text: the TASKS-I01 depth trigger raises
// `TASKS-I01 depth one required`, so `isTriggerViolation(error, 'TASKS-I01')`.
export function isTriggerViolation(error: unknown, prefix?: string) {
  const violation = error instanceof Error ? constraintViolation(error) : null;
  if (violation?.kind !== 'trigger') return false;
  return prefix === undefined || violation.message.startsWith(prefix);
}
