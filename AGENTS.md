# Agent Guide

## Start Here

Read `README.md` and `docs/REPOSITORY_MAP.md` before changing package boundaries. Read `docs/MODELS.md` before changing the plan format, adding a section, or touching parsing, formatting, or persistence. The root is an npm workspace; run commands from the repository root unless debugging one package.

## Invariants

- `packages/api/src/plans/models/` holds the authoritative model definitions. `plans/domain.ts` is a re-export shim; do not add schemas to it.
- A section heading, singular item label, reference prefix, status value, persistence kind, or patch metadata name is declared in exactly one descriptor and never re-spelled at a call site, in any package. Cross-package consumers import those values from `@planner/api` instead of re-declaring them.
- Plan-specific code belongs under `packages/api/src/plans/`. Top-level modules such as `server.ts` stay document-type agnostic and delegate to feature folders.
- A parent model never reimplements a child model's parsing; it delegates to the child or to the shared section walker.
- Markdown input must be parsed by a Markdown parser, not regular expressions over the whole document. Narrow heading validation may use regular expressions after AST parsing.
- Database writes for a plan must remain transactional; an update replaces all child components/items atomically.
- `reference: New` creates a plan. A persisted reference updates that plan.
- Canonical downloads must contain the persisted reference and remain parseable on re-upload.
- MCP tools communicate with storage only through the REST client.
- Keep bulk plan upload/download in the skill scripts until the product scope explicitly changes.
- Shell downloads must remain atomic and scripts must quote file paths.
- Do not weaken or remove automated testing. Add tests at the boundary affected by each change.

## Plan Normalization

- Plan numbering is normalized by the backend during Markdown ingest and sync. Agents must not renumber components or subsections themselves.
- Agents do not need to reorder plan files before upload. The sync process orders components by their document order and assigns canonical component and subsection references automatically.
- Reference rewriting is centralized in `packages/api/src/plans/models/normalize.ts` and driven by the descriptor registry. A new reference-bearing section declares its own `aliases` and `referenceRole`; nothing else needs editing for its references to be renumbered and rewritten.
- Add parser, formatter, API, and round-trip tests whenever a new reference-bearing section is introduced. Unknown references should remain unchanged and be reported through `validationFailures.ordering`.
- Follow the walkthrough in `docs/MODELS.md` when adding a section or a model field.

## Documentation

- Docs describe the current state of the project only. Do not explain legacy behavior, previous implementations, or how behavior changed over time (for example, avoid phrasing like "matching what X has always done"). If a behavior is new or deliberate, document it as current fact without narrating its history.

## Commands

```sh
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
npm run check
```

## Commits

- Use Conventional Commits for every commit, for example `feat: add plan deletion` or `fix: preserve code blocks in plan Markdown`.

## Testing Rules

- Unit tests cover parser and formatter edge behavior.
- Integration tests cover real SQLite interactions and server injection.
- MCP tests invoke tools over an SDK in-memory transport rather than calling registration callbacks directly.
- End-to-end tests use a real loopback HTTP listener and invoke the actual shell scripts.
- Use `:memory:` or a temporary directory for test databases. Never use the default persistent database in tests.
- Every bug fix requires a regression test that fails before the fix.

## Skill-Specific Rule

The planning skill is intentionally project-agnostic. Do not alter its prohibition against exploring the active workspace or reading linked/referenced material without explicit user permission.
