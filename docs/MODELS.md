# Plan Models

How the plan document format is defined in code, and how to change it.

Everything the format knows about a model type — its section heading, singular item label,
model key, reference aliases, status values, persistence kind, and patch vocabulary —
lives in exactly one **descriptor**. Parsing, formatting, reference normalization, patch
merging, persistence, and HTTP retrieval all read those descriptors. None of them spells a
section name.

## Layout

```
packages/api/src/
  server.ts                  Generic Fastify app; registers feature routers only.
  plans/
    routes.ts                All /plans* routes.
    repository.ts            SQLite class and literal DDL.
    patch.ts                 Patch merge, positioning, provenance, reference diffing.
    domain.ts                Re-export shim over models/.
    markdown.ts              Codec entry points and the excerpt renderer.
    models/
      descriptor.ts          Descriptor and context types.
      registry.ts            Lazy aggregates and lookups.
      section.ts             Generic walkers for the three section shapes.
      plan.ts                Document root; owns the parse context.
      component.ts           COMP node and the six item sections.
      actionItem.ts          ACTION node and its three subsections.
      textItem.ts            Generic status-free item model and section factory.
      decision.ts            Item model with a decision status.
      knowledgeGap.ts        Item model with a status and the Findings subsection.
      normalize.ts           Renumbering and prose reference rewriting.
    shared/
      ast.ts                 mdast helpers; the only module that touches the parser.
      refs.ts                All COMP-/ACTION- matchers, derived from one prefix.
      errors.ts              Descriptor-driven parse error messages.
```

## Current sections

| Owner | Heading | Shape | Singular label | Statuses | DB kind |
|---|---|---|---|---|---|
| Component | Requirements | headingItems | Requirement | — | `requirement` |
| Component | Constraints | headingItems | Constraint | — | `constraint` |
| Component | Decisions | headingItems | Decision | Open, Decided, Closed | `decision` |
| Component | Knowledge Gaps | headingItems | Knowledge Gap | Open, Resolved, Closed | `knowledge_gap` |
| Component | Notes | headingItems | Note | — | `note` |
| Component | Open Questions | headingItems | Question | — | `question` |
| Knowledge Gap | Findings | prose | — | — | stored as a named findings row |
| Action item | Acceptance Criteria | headingItems | Acceptance Criteria | — | own table |
| Action item | Trigger Sources | bulletList | — | — | own table |
| Action item | Assignees | bulletList | — | — | own table |

Plan status values are Draft, In Progress, Done, Closed. Action item status values are
TODO, In Progress, Done, Closed.

## The three section shapes

A section descriptor is discriminated by `shape`.

### `headingItems`

A `###` section whose entries are `####` headings with a prose body. Used by all six
component sections and by Acceptance Criteria.

| Field | Meaning |
|---|---|
| `key` | Field name on the parent model, e.g. `requirements`. Must match the Zod schema. |
| `heading` | Exact `### <heading>` text. |
| `singularLabel` | Singular item label used in item headings, e.g. `Requirement`. |
| `aliases` | Regex fragments recognized in prose references, e.g. `reqs?`. |
| `referenceRole` | `renumber`, `suppress`, or `none`. See below. |
| `statuses` | Allowed status values, or `null` when the item carries no status. |
| `dbKind` | Value stored in `items.kind`, or `null` when not persisted there. |
| `required` | Whether a strict document must contain the section. |
| `sectionDepth` / `itemDepth` | Heading depths of the section and its items. |
| `headingBold` | Whether the heading renders as `### **X**` or `### X`. |
| `trimSectionBody` | Whether an empty section collapses its trailing blank line. |
| `subsections` | Nested prose subsections belonging to each item. |
| `patchFields` | Metadata field names accepted on an item in a partial document. |
| `detailsTransform` | Optional encode/decode pair, e.g. Open Questions' blockquote. |
| `model` | The item model implementing validation, projection, and persistence. |

`referenceRole` controls normalization:

- `renumber` — items are renumbered by position and prose references to them are rewritten.
- `suppress` — references are not rewritten, but text matching the aliases is not reported
  as an unresolved reference either. Acceptance Criteria uses this.
- `none` — the section takes no part in reference handling.

### `bulletList`

A `###` section whose body is a Markdown list. Used by Trigger Sources and Assignees.
Adds `entryLabel` and `entrySyntax` (used in parse errors) plus `decodeEntry` /
`encodeEntry`. `decodeEntry` returns `undefined` for a malformed line.

### `prose`

A nested subsection holding free Markdown, e.g. `##### Findings` under a knowledge gap.
Adds `depth`, `rejectNestedLabel` (a heading starting with this label inside the prose is
an error), and `requiredForStatuses` (statuses that require the body to be non-empty).

## Node descriptors

`plan`, `component`, and `actionItem` each carry a `NodeDescriptor`. The important
invariant is that `refPattern`, the heading matchers, the dispatch prefilters, and the
`New` placeholder are all derived from a single `refPrefix` by `shared/refs.ts`. Never
write a `COMP-` or `ACTION-` regex anywhere else — that is precisely how the old heading
matchers drifted into accepting `COMPONENT`, which the schema rejected.

## The item model contract

```
schema        Zod schema for one item
fromParsed    (parsed, section) => domain item
format        (item, section) => Markdown, excluding the section heading
toRow         (item) => { ref, title, details, status }
fromRow       (row, subsections) => domain item
```

`subsections` maps each nested prose subsection key to its ordered stored bodies.

## Strict and partial parsing

Both modes share one traversal. `createParseContext(source, mode)` builds the context;
`mode` changes only two things:

- **Required sections.** Strict mode rejects a missing required section. Partial mode does
  not, because a partial document omits whatever it is not changing.
- **Leading metadata.** Strict mode extracts only a `Status:` line and leaves any other
  `**Key:** value` line in the prose. Partial mode validates the block against the
  descriptor's `patchFields`.

`parseHeadingItems` returns shape-neutral `ParsedItem` values. The strict parser projects
them through `section.model.fromParsed`; the patch parser projects the same values into
patch operations. There is no second parser.

## Walkthrough: adding a component subsection

Say you want a `Risks` section whose items look like `#### Risk 1.A - Data loss`.

**1. Declare the section.** If the item has no status and no nested subsection, use the
factory in `textItem.ts`. Put it in `component.ts` next to the other plain sections:

```ts
export const risksSection = textSection({
  key: "risks",
  heading: "Risks",
  singularLabel: "Risk",
  aliases: ["risks?", "rsk"],
  dbKind: "risk",
});
```

If the item needs a status or a nested subsection, create `models/risk.ts` modelled on
`decision.ts` or `knowledgeGap.ts` and export a full `HeadingItemsSection` from it.

**2. Add it to the section list**, in the document order you want it rendered:

```ts
export const componentItemSections: Array<HeadingItemsSection<ComponentItemKey>> = [
  requirementsSection,
  // ...
  risksSection,
];
```

**3. Add the schema field** in `componentSchema`. Field names are TypeScript structure, not
Markdown vocabulary, so they are written literally:

```ts
risks: z.array(textItemSchema),
```

**4. Add the DDL if needed.** Nothing is required for a plain item: it is stored in the
existing `items` table under its `dbKind`. Only a genuinely new table needs DDL, which
stays literal in `repository.ts`.

**5. Add tests.** At minimum a round-trip case in the golden corpus and, if the section
introduces a new shape, parser and formatter cases at that boundary.

That is the whole change — for a **component** subsection. Parsing, formatting, renumbering,
prose reference rewriting, patch operations, and persistence pick it up immediately;
`extensibility.test.ts` performs exactly this procedure at a *runtime*-registered section
and asserts each of those behaviors.

The walkthrough is scoped to components because the shared `items` table joins to
components by foreign key. A heading-item section declared on another node type — today, an
action item — still gets parsing, formatting, and reference normalization automatically:
its items are renumbered by position with the bare letter scheme that node already uses,
and prose references rewrite through its aliases (`action-section-normalization.test.ts`
pins this). It persists only if you give it its own table: add DDL in `repository.ts` plus
the matching save/get row mapping. The registry aggregates never filter by node type; they
hand every consumer every section that declares the renumber role or a persistence kind, so
nothing is skipped silently just because a section lives on another node.

The HTTP retrieval route for a status-bearing section is also derived from the descriptor,
but it materializes only on servers constructed after the section exists:
`registerPlanRoutes` iterates the sections once when `createServer` runs, so an already-
running process serves no such route until it restarts. `route-registration.test.ts` pins
that timing; changing it is a deliberate decision, not a refactor.

## Walkthrough: adding a field to an existing model

1. Add the field to the model's Zod schema.
2. Extend that model's `fromParsed` and `format` so it round-trips through Markdown.
3. Extend `toRow` / `fromRow`, and add the column to the DDL in `repository.ts`.
4. If a partial document may set it, add its metadata name to the section's `patchFields`
   and extend `toItemPatch` and `applyItemValue` in `patch.ts`.
5. Add a round-trip test and a persistence test.

## Rules

- A section heading, singular label, reference prefix, status value, or persistence kind is
  written in exactly one file: the descriptor that declares it. `source-hygiene.test.ts`
  enforces this.
- No parallel correspondence tables. If you need a view over the descriptors, add a lookup
  to `registry.ts`; do not hand-maintain a second list.
- Registry aggregates are computed on demand, not captured at module load, so a
  runtime-registered section stays visible. Preserve that.
- Reference normalization is node-generic: any heading-item section on any node with the
  `renumber` role is renumbered by position and rewritten in prose (components number items
  `<n>.<letter>`; action items use bare letters). The shared `items` table stores
  component-owned sections only; a persisted section on another node type needs its own
  table, DDL, and row mapping.
- A parent model never reimplements a child's parsing. It delegates to the child model or
  to the section walker.
- Parse error messages are built in `shared/errors.ts` from descriptor values. Do not
  inline a heading string into an error.
- All mdast access goes through `shared/ast.ts`.

## Known deliberate behaviors

These are preserved on purpose and pinned by `characterization-markdown.test.ts`. Changing
one is a format change, not a refactor.

- A knowledge gap with no findings still renders an empty `##### Findings` heading.
- An action item with empty subsections renders blank bodies between its headings.
- A `## COMP-1 Title` heading missing the ` - ` separator is silently skipped rather than
  rejected.
- Reference rewriting operates on raw detail strings, so it also rewrites text inside
  fenced code blocks and reports unresolved references found there.
- Prose may spell a component reference as `COMPONENT 1`; headings may not.
- A strict document may write `Status: Open` without bold markers. A partial document may
  not; the tolerance is implemented by `readStatusLine` in `shared/ast.ts`, which both
  status call sites share.
- Strict documents reject unknown and duplicated `###` subsections inside an action item,
  matching what strict components and all partial parsing have always done. The unification 
  into one walker kept the stricter behavior on purpose (pinned in 
  `characterization-markdown.test.ts`).
- Sections whose items own nested subsections locate item boundaries by label, so a stray
  same-depth heading carrying another section's valid label cannot split an item from its
  subsection and is skipped; a stray heading that no section label recognizes is rejected
  in both strict and partial mode rather than silently dropped with its body text.

## Deferred

Item details are extracted by slicing the original Markdown using mdast position offsets,
which preserves the author's exact formatting. Serializing the subtree with
`mdast-util-to-markdown` would reformat user content and break canonical round trips, so
it is deferred. `contentBetween` in `shared/ast.ts` is the single site that would change.
