import { describe, expect, it } from 'vitest';
import { evaluateCatalog, evaluateTable, parseEntityTables, type CustomObjects } from '../schema';
const custom: CustomObjects = { indexes: { people: ['people_search_idx'] }, triggers: {} };
const shape = {
  name: 'people',
  columns: [
    { name: 'id', notNull: true },
    { name: 'revision', notNull: true },
    { name: 'kind', notNull: true },
  ],
  indexes: ['people_name_idx'],
  checks: ['people_kind_check'],
  foreignKeyColumns: [['user_id']],
};
const table = {
  name: 'people',
  columns: [
    { name: 'id', nullable: false, generated: false },
    { name: 'kind', nullable: true, generated: false },
    { name: 'legacy', nullable: true, generated: false },
  ],
  indexes: [
    { name: 'stray_idx', definition: 'CREATE INDEX "stray_idx" ON "people" ("kind")' },
  ],
  constraints: [
    { name: 'primary', type: 'p', definition: 'PRIMARY KEY (id)' },
    { name: 'people_kind_check', type: 'c', definition: "CHECK (kind in ('internal'))" },
    { name: 'extra_check', type: 'c', definition: 'CHECK (true)' },
  ],
  triggers: ['surprise_trigger'],
};
describe('audit:schema', () => {
  it('reports every class of drift between Drizzle, custom objects, rules and the catalog', () => {
    const findings = evaluateTable(
      shape,
      table,
      custom,
      ['people'],
      [{ table: 'people', column: 'kind', options: ['internal', 'external'] }],
    );
    expect(findings.map((f) => `${f.rule}:${f.message}`)).toEqual([
      'column-missing:revision is declared but absent',
      'column-nullability:kind nullability differs',
      'column-drift:legacy exists only in the database',
      'index-missing:people_name_idx',
      'index-missing:people_search_idx',
      'index-drift:stray_idx exists only in the database',
      'check-drift:extra_check exists only in the database',
      'trigger-drift:surprise_trigger is not declared in drizzle/custom-objects.json',
      'fk-index:user_id has no leading index',
      'entity-columns:entity table lacks revision',
      'entity-columns:entity table lacks created_at',
      'entity-columns:entity table lacks updated_at',
      'entity-columns:entity table lacks created_by',
      'entity-columns:entity table lacks updated_by',
      'entity-columns:entity table lacks deleted_at',
      'entity-columns:entity table lacks deleted_op_id',
      'enum-check:kind has no CHECK listing internal, external',
    ]);
    const catalog = evaluateCatalog(
      [shape, { ...shape, name: 'ghost' }],
      [table, { ...table, name: 'orphan' }],
      custom,
      [],
      [],
    );
    expect(catalog.violations.map((v) => v.rule)).toEqual(
      expect.arrayContaining(['table-missing', 'table-drift']),
    );
    expect(parseEntityTables('| **Entity** | tasks, notes, people | cols |')).toEqual([
      'tasks',
      'notes',
      'people',
    ]);
  });
  it('accepts a table that matches its declaration', () => {
    const clean = {
      ...table,
      columns: [
        { name: 'id', nullable: false, generated: false },
        { name: 'revision', nullable: false, generated: false },
        { name: 'kind', nullable: false, generated: false },
      ],
      indexes: [
        { name: 'people_name_idx', definition: 'CREATE INDEX "people_name_idx" ON "people" ("full_name", "id")' },
        { name: 'people_search_idx', definition: 'CREATE INDEX "people_search_idx" ON "people" ("search_text")' },
        { name: 'people_user_id_unique', definition: 'CREATE UNIQUE INDEX "people_user_id_unique" ON "people" ("user_id")' },
      ],
      constraints: [
        { name: 'primary', type: 'p', definition: 'PRIMARY KEY (id)' },
        {
          name: 'people_kind_check',
          type: 'c',
          definition: "CHECK (kind in ('internal','external'))",
        },
      ],
      triggers: [],
    };
    expect(
      evaluateTable(
        shape,
        clean,
        custom,
        [],
        [{ table: 'people', column: 'kind', options: ['internal', 'external'] }],
      ),
    ).toEqual([]);
  });
});
