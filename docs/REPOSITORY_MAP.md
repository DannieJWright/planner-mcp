# Repository Map

## Package Boundaries

### `@planner/api`

Generic infrastructure lives at the top level; everything that knows what a plan is lives
in the `plans/` feature folder. A second document type would be added as a sibling feature
folder registering its own routes with the same server.

- `src/server.ts`: generic Fastify application, body parsing, `/health`, and lifecycle. Registers feature routers; contains no plan knowledge.
- `src/main.ts`: production process entry point and environment mapping.
- `src/index.ts`: public export surface.

Inside `src/plans/`:

- `models/`: the authoritative model definitions. Each model type owns its Zod schema plus a descriptor holding every name belonging to it, and its own parse, format, and row mapping. See `docs/MODELS.md`.
- `models/registry.ts`: lazy aggregates and lookups over the descriptors.
- `models/section.ts`: generic walkers for the three section shapes, shared by strict and partial parsing.
- `models/normalize.ts`: reference renumbering and prose rewriting.
- `shared/ast.ts`, `shared/refs.ts`, `shared/errors.ts`: mdast helpers, all reference matchers, and descriptor-driven error messages.
- `markdown.ts`: codec entry points and items-only excerpt rendering.
- `patch.ts`: the merge/reorder engine, node provenance, and reference-change diffing. Partial parsing is delegated to the models in partial mode.
- `repository.ts`: normalized SQLite persistence, literal DDL, and the transaction boundary. Row mapping is delegated to the item models.
- `routes.ts`: all `/plans*` HTTP contracts.
- `domain.ts`: compatibility shim re-exporting the model schemas and types.

The API package owns the plan format. Other packages must interact through HTTP unless they are tests for this package.

### `@planner/mcp`

- `src/api-client.ts`: REST transport and response validation boundary.
- `src/server.ts`: MCP tool registration.
- `src/main.ts`: stdio transport process entry point.

The MCP server must write protocol traffic only to stdio through the SDK. Diagnostics belong on stderr. Bulk Markdown file transfer remains the skill scripts' responsibility; the direct-upload tools are additive and do not replace them.

### `skills/idea-planner`

- `SKILL.md`: phase-gated workflow: decomposition, user refinement, ingest, then an explicit-permission interview that refines and re-ingests the plan.
- `scripts/upload-plan.sh`: streams a Markdown file to the API.
- `scripts/download-plan.sh`: atomically downloads canonical Markdown.
- `scripts/sync-plan.sh`: composes upload and download while printing the reference.

Scripts are located with the skill so an installed skill remains self-contained.

## Runtime Flow

1. An agent organizes a user's brain dump into the canonical Markdown format.
2. `sync-plan.sh` uploads the file bytes to `PUT /plans`.
3. The API parses frontmatter and Markdown AST nodes into typed models.
4. `PlanRepository.save` stores plan metadata, components, classified items, knowledge-gap findings, and action items in one SQLite transaction.
5. The script downloads `GET /plans/:reference`; the API reconstructs canonical Markdown from database rows.
6. MCP `list_plans` calls `GET /plans` and presents metadata to the agent.
7. On an explicit user deletion request, MCP `delete_plan` calls `DELETE /plans/:reference`; SQLite cascades deletion to components and items.
8. MCP `upload_plan` calls `PUT /plans` (full) or `PATCH /plans/:reference` (partial). A partial document is parsed by `patch.ts`, merged against the stored plan, reordered, normalized by `markdown.ts`, and saved through the same transactional `PlanRepository.save`.
9. MCP `remove_component` calls `DELETE /plans/:reference/components/:componentRef`, which funnels through the same normalize-then-save-then-diff path as a partial upload, so both report reference changes identically.
10. MCP `list_open_knowledge_gaps` / `list_open_decisions` call the nested retrieval sub-resources, which filter by status, group by component, and order by canonical reference.

## Environment Map

| Variable | Owner | Default | Purpose |
|---|---|---|---|
| `PLANNER_DB_PATH` | API | `planner.sqlite` | SQLite file path; `:memory:` is useful for tests |
| `PLANNER_API_HOST` | API | `127.0.0.1` | Bind host |
| `PLANNER_API_PORT` | API | `3000` | Bind port |
| `PLANNER_API_URL` | MCP and scripts | `http://127.0.0.1:3000` | REST API base URL |

## Extension Points

- Add a plan section or model field by following `docs/MODELS.md`. A new component subsection is one section descriptor plus its schema field; parsing, formatting, renumbering, patching, persistence, and retrieval routes all follow from the descriptor.
- Never spell a section heading, singular item label, reference prefix, status value, or persistence kind outside the descriptor that declares it. `source-hygiene.test.ts` enforces this.
- Add REST operations for plans through `plans/routes.ts`; keep `server.ts` document-type agnostic and keep persistence out of route handlers.
- Add MCP tools through `packages/mcp/src/server.ts` and transport behavior through `api-client.ts`.
- Node movement must happen only in `patch.ts`; `normalizePlan()` in `plans/models/normalize.ts` assigns references strictly by array index, and reference-change diffing depends on that alignment.
- Put plan-specific code under `packages/api/src/plans/`; top-level modules stay document-type agnostic.
- Add future packages under `packages/*`; npm workspaces discover them automatically.
- Introduce explicit database migrations before changing a schema used by released persistent databases.

## Test Map

| Layer | Evidence |
|---|---|
| Unit | Markdown parsing, classification field mapping, canonical round-trip, partial-document parsing, and the patch/reorder/reference-diff engine. Under `tests/unit/plans/`, plus registry-consistency, source-hygiene, and characterization suites that pin the format byte for byte |
| Integration | SQLite create/update/retrieve, Fastify route behavior, partial upload, component removal, and item retrieval. Under `tests/integration/plans/`, plus an extensibility suite that registers a section at runtime and asserts every layer picks it up |
| MCP integration | REST client errors, destructive tool metadata, and MCP in-memory transport tool invocation |
| End-to-end | Real HTTP listener plus shell upload/download/sync scripts |
