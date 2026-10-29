import { z } from 'zod';
export const Direction = z.enum(['higher', 'lower']);
export type Direction = z.infer<typeof Direction>;
// The cadence a KPI is reported on. It decides what a period is everywhere: the target a reading is
// measured against, the label on the trend's axis, the steps of the record's comparison toggle, and
// how long a reading stays current.
export const Frequency = z.enum(['monthly', 'quarterly', 'annual']);
export type Frequency = z.infer<typeof Frequency>;
// A closed list, so a value always carries a symbol a reader recognizes rather than free text
// somebody has to spell the same way twice.
export const Unit = z.enum(['count', 'percent', 'sar', 'usd', 'points']);
export type Unit = z.infer<typeof Unit>;
export const PeriodRef = z.object({
  year: z.number().int(),
  period: z.number().int().min(1).max(12),
});
// KPIS-B01: "off target" and "no data" are different answers, so the status enum keeps them apart.
export const KpiStatus = z.enum([
  'on_target',
  'near_target',
  'off_target',
  'no_data',
  'stale',
  'no_target',
]);
export type KpiStatus = z.infer<typeof KpiStatus>;
export const View = z.enum([
  'all',
  'attention',
  'on_target',
  'near_target',
  'off_target',
  'no_data',
  'stale',
  'no_target',
  'trash',
]);
export const Sort = z.enum(['default', 'attention', 'status', 'name', 'change']);
export const ComparePeriod = z.enum(['', 'previous', 'next']); // KPIS-B26; '' is the effective one
// docs/03 § Numbers: numeric(14,4) with an absolute value under 10^10, so the value survives the
// JSON boundary exactly. Rounding here keeps the stored value and the validated value identical.
const Amount = z
  .number()
  .gt(-10000000000)
  .lt(10000000000)
  .transform((value) => Math.round(value * 10000) / 10000);
const timestamp = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.iso.datetime({ offset: true }),
);
export const ObjectiveCreate = z.strictObject({
  name: z.string().trim().min(1).max(500),
  description: z.string().max(50000).default(''),
});
export type ObjectiveCreate = z.infer<typeof ObjectiveCreate>;
export const ObjectivePatch = z.strictObject({
  name: ObjectiveCreate.shape.name.optional(),
  description: z.string().max(50000).optional(),
  revision: z.number().int().positive(),
});
export type ObjectivePatch = z.infer<typeof ObjectivePatch>;
export const Objective = ObjectiveCreate.extend({
  id: z.uuid(),
  revision: z.number().int(),
  sortOrder: z.number().int(),
  kpiCount: z.number().int(),
  createdAt: timestamp,
  updatedAt: timestamp,
  createdBy: z.uuid().nullable(),
  updatedBy: z.uuid().nullable(),
  deletedAt: timestamp.nullable(),
  deletedOpId: z.uuid().nullable(),
}).strip();
export type Objective = z.infer<typeof Objective>;
export const ObjectiveList = z.object({ data: z.array(Objective) });
export const KpiCreate = z.strictObject({
  name: z.string().trim().min(1).max(500),
  unit: Unit.default('count'),
  direction: Direction.default('higher'),
  category: z.string().trim().max(100).default(''),
  objectiveId: z.uuid().nullable().default(null),
  ownerId: z.uuid().nullable().default(null),
  notes: z.string().max(50000).default(''),
  frequency: Frequency.default('quarterly'),
  // KPIS-B30: the owner is told when a period closes in on them without a reading.
  remindersEnabled: z.boolean().default(true),
});
export type KpiCreate = z.infer<typeof KpiCreate>;
export const KpiPatch = z.strictObject({
  name: KpiCreate.shape.name.optional(),
  unit: Unit.optional(),
  direction: Direction.optional(),
  category: z.string().trim().max(100).optional(),
  objectiveId: z.uuid().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  notes: z.string().max(50000).optional(),
  frequency: Frequency.optional(),
  remindersEnabled: z.boolean().optional(),
  revision: z.number().int().positive(),
});
export type KpiPatch = z.infer<typeof KpiPatch>;
export const Point = z.object({ date: z.iso.date(), value: z.number() });
export type Point = z.infer<typeof Point>;
// Everything the row and the gauge read, computed once per request (statuses are never stored).
export const KpiMeta = z.object({
  // The last reading taken, whichever period it falls in, and its date.
  current: z.number().nullable(),
  currentDate: z.iso.date().nullable(),
  // KPIS-B31: the effective period's own figure; null when nothing is dated inside it.
  value: z.number().nullable(),
  previous: z.number().nullable(),
  percentChange: z.number().nullable(),
  effectiveTarget: z.number().nullable(),
  effectiveTargetPeriod: PeriodRef.nullable(),
  status: KpiStatus,
  achievement: z.number().nullable(),
  sparkline: z.array(Point),
});
export type KpiMeta = z.infer<typeof KpiMeta>;
export const Kpi = KpiCreate.extend({
  id: z.uuid(),
  revision: z.number().int(),
  sortOrder: z.number().int(),
  objectiveName: z.string().nullable(),
  objectiveOrder: z.number().int().nullable().default(null),
  objectiveDeleted: z.boolean(),
  ownerName: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  createdBy: z.uuid().nullable(),
  updatedBy: z.uuid().nullable(),
  deletedAt: timestamp.nullable(),
  deletedOpId: z.uuid().nullable(),
  meta: KpiMeta,
}).strip();
export type Kpi = z.infer<typeof Kpi>;
export const Reading = z.object({
  id: z.uuid(),
  revision: z.number().int(),
  readingDate: z.iso.date(),
  value: z.number(),
  note: z.string(),
  future: z.boolean(),
  createdAt: timestamp,
});
export type Reading = z.infer<typeof Reading>;
export const Target = z.object({
  id: z.uuid(),
  year: z.number().int(),
  period: z.number().int().min(1).max(12),
  targetValue: z.number(),
});
export type Target = z.infer<typeof Target>;
export const PeriodComparison = PeriodRef.extend({
  value: z.number().nullable(),
  target: z.number().nullable(),
});
// KPIS-B08: the three periods around the one the KPI is measured against, so the record can be read
// against the period before it and the one after it without another request. The middle entry is
// the effective period, and it repeats the row's own answer exactly.
export const PeriodView = PeriodRef.extend({
  // KPIS-B31: the reading that period holds of its own, never one borrowed from another period.
  value: z.number().nullable(),
  target: z.number().nullable(),
  achievement: z.number().nullable(),
  status: KpiStatus,
});
export type PeriodView = z.infer<typeof PeriodView>;
export const KpiDetail = Kpi.extend({
  readings: z.array(Reading),
  targets: z.array(Target),
  previousPeriod: PeriodComparison.nullable(),
  periods: z.array(PeriodView),
});
export type KpiDetail = z.infer<typeof KpiDetail>;
export const KpiListQuery = z.strictObject({
  view: View.default('all'),
  q: z.string().max(500).default(''),
  objectiveId: z.string().max(100).default(''),
  category: z.string().max(100).default(''),
  ownerId: z.string().max(100).default(''),
  period: ComparePeriod.default(''),
  sort: Sort.default('default'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(4000).optional(),
});
export type KpiListQuery = z.infer<typeof KpiListQuery>;
export const KpiList = z.object({
  data: z.array(Kpi),
  meta: z.object({
    counts: z.record(z.string(), z.number()),
    nextCursor: z.string().nullable(),
  }),
});
const Named = z.object({ id: z.uuid(), name: z.string() });
export const KpiFacets = z.object({
  categories: z.array(z.string()),
  // KPIS-B30: `hasLogin` says whether a reminder can reach the owner at all.
  owners: z.array(Named.extend({ hasLogin: z.boolean().default(false) })),
  objectives: z.array(Named),
});
export const ReadingCreate = z.strictObject({
  readingDate: z.iso.date(),
  value: Amount,
  note: z.string().trim().max(2000).default(''),
});
export type ReadingCreate = z.infer<typeof ReadingCreate>;
export const ReadingUpsert = z.strictObject({
  value: Amount,
  note: z.string().trim().max(2000).default(''),
});
export const ReadingPatch = z.strictObject({
  value: Amount.optional(),
  note: z.string().trim().max(2000).optional(),
  revision: z.number().int().positive(),
});
export type ReadingPatch = z.infer<typeof ReadingPatch>;
export const TargetsPut = z.strictObject({
  items: z
    .array(
      z.strictObject({
        year: z.number().int().min(1900).max(2999),
        period: z.number().int().min(1).max(12),
        targetValue: Amount,
      }),
    )
    .min(1)
    .max(40)
    .refine(
      (items) => new Set(items.map((item) => `${item.year}-${item.period}`)).size === items.length,
      { error: 'duplicate_period' },
    ),
});
export type TargetsPut = z.infer<typeof TargetsPut>;
export const TargetList = z.object({ data: z.array(Target) });
export const ReadingList = z.object({ data: z.array(Reading) });
export const Revision = z.strictObject({ revision: z.number().int().positive() });
export const Reorder = z.strictObject({
  items: z
    .array(z.strictObject({ id: z.uuid(), revision: z.number().int().positive() }))
    .min(1)
    .max(200)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length),
});
export const KpiReference = z.object({ id: z.uuid(), name: z.string(), deleted: z.boolean() });
// ── KPIS-B32: the executive brief ──────────────────────────────────────────────────────────────
export const NarrativeLocale = z.enum(['en', 'ar']);
export const NarrativePeriod = z.enum(['previous', 'current', 'next']);
export const NarrativeStatus = z.enum(['generating', 'ready', 'failed']);
// The scope a brief is written over: the whole scorecard, one objective, or one KPI.
export const NarrativeScope = z.strictObject({
  kpiId: z.uuid().optional(),
  objectiveId: z.uuid().optional(),
  locale: NarrativeLocale.default('en'),
  period: NarrativePeriod.default('current'),
});
export type NarrativeScope = z.infer<typeof NarrativeScope>;
// What the model returns. It cites a measure by the short code the input gave it, never by id,
// so a citation can only ever point at a measure that was in the brief's own figures.
export const NarrativeAiOutput = z.object({
  headline: z.string().trim().min(1).max(300),
  bodyMarkdown: z.string().trim().min(1).max(8000),
  highlights: z
    .array(z.object({ code: z.string().max(10), summary: z.string().trim().min(1).max(600) }))
    .max(12),
});
export const NarrativeHighlight = z.object({
  kpiId: z.uuid(),
  code: z.string(),
  name: z.string(),
  status: KpiStatus,
  summary: z.string(),
});
export type NarrativeHighlight = z.infer<typeof NarrativeHighlight>;
export const Narrative = z.object({
  id: z.uuid(),
  kpiId: z.uuid().nullable(),
  objectiveId: z.uuid().nullable(),
  locale: NarrativeLocale,
  periodMode: NarrativePeriod,
  dataHash: z.string(),
  status: NarrativeStatus,
  headline: z.string().nullable(),
  bodyMarkdown: z.string().nullable(),
  highlights: z.array(NarrativeHighlight),
  error: z.string().nullable(),
  createdAt: timestamp,
});
export type Narrative = z.infer<typeof Narrative>;
export const NarrativeView = z.object({
  data: z.object({
    narrative: Narrative.nullable(),
    currentDataHash: z.string(),
    isStale: z.boolean(),
  }),
});
export type NarrativeView = z.infer<typeof NarrativeView>;
