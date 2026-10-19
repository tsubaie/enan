import 'server-only';
import type { SQL } from 'drizzle-orm';
import { z } from 'zod';
// SQLite's JSON functions return text (ADR 0029). Repos select embedded documents with
// `json_object`/`json_group_array` and decode them here. `Row` is the shape the repo's own SQL
// builds, so the cast states what the query guarantees rather than validating it twice.
export const embeddedJson = <Row, R>(query: SQL, shape: (row: Row) => R) =>
  query.mapWith(
    (value: string | null) => (value === null ? null : shape(JSON.parse(value) as Row)), // cast: the repo's json_object shape
  );
// A JSON array expression, validated as JSON; the caller checks each element's shape.
export const jsonRows = (query: SQL) =>
  query.mapWith((value: string | null) =>
    value === null ? [] : z.json().parse(JSON.parse(value)),
  );
