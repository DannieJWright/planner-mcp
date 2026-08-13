# Agent Guide

## Start Here

Read `README.md` and `docs/REPOSITORY_MAP.md` before changing package boundaries. The root is an npm workspace; run commands from the repository root unless debugging one package.

## Invariants

- `packages/api/src/domain.ts` is the authoritative model definition.
- Markdown input must be parsed by a Markdown parser, not regular expressions over the whole document. Narrow heading validation may use regular expressions after AST parsing.
- Database writes for a plan must remain transactional; an update replaces all child components/items atomically.
- `reference: New` creates a plan. A persisted reference updates that plan.
- Canonical downloads must contain the persisted reference and remain parseable on re-upload.
- MCP tools communicate with storage only through the REST client.
- Keep bulk plan upload/download in the skill scripts until the product scope explicitly changes.
- Shell downloads must remain atomic and scripts must quote file paths.
- Do not weaken or remove automated testing. Add tests at the boundary affected by each change.

## Commands

```sh
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
npm run check
```

## Testing Rules

- Unit tests cover parser and formatter edge behavior.
- Integration tests cover real SQLite interactions and server injection.
- MCP tests invoke tools over an SDK in-memory transport rather than calling registration callbacks directly.
- End-to-end tests use a real loopback HTTP listener and invoke the actual shell scripts.
- Use `:memory:` or a temporary directory for test databases. Never use the default persistent database in tests.
- Every bug fix requires a regression test that fails before the fix.

## Skill-Specific Rule

The planning skill is intentionally project-agnostic. Do not alter its prohibition against exploring the active workspace or reading linked/referenced material without explicit user permission.
