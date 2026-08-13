# Repository Map

## Package Boundaries

### `@planner/api`

- `src/domain.ts`: authoritative Zod schemas and TypeScript plan types.
- `src/markdown.ts`: Markdown/frontmatter to model parsing and canonical model to Markdown formatting.
- `src/repository.ts`: normalized SQLite persistence and transaction boundary.
- `src/server.ts`: injectable Fastify application and HTTP contracts.
- `src/main.ts`: production process entry point and environment mapping.

The API package owns the plan format. Other packages must interact through HTTP unless they are tests for this package.

### `@planner/mcp`

- `src/api-client.ts`: REST transport and response validation boundary.
- `src/server.ts`: MCP tool registration.
- `src/main.ts`: stdio transport process entry point.

The MCP server must write protocol traffic only to stdio through the SDK. Diagnostics belong on stderr. Bulk plan contents are deliberately excluded from its initial tool surface.

### `skills/idea-planner`

- `SKILL.md`: phase-gated user thought organization workflow.
- `scripts/upload-plan.sh`: streams a Markdown file to the API.
- `scripts/download-plan.sh`: atomically downloads canonical Markdown.
- `scripts/sync-plan.sh`: composes upload and download while printing the reference.

Scripts are located with the skill so an installed skill remains self-contained.

## Runtime Flow

1. An agent organizes a user's brain dump into the canonical Markdown format.
2. `sync-plan.sh` uploads the file bytes to `PUT /plans`.
3. The API parses frontmatter and Markdown AST nodes into typed models.
4. `PlanRepository.save` stores plan metadata, components, and classified items in one SQLite transaction.
5. The script downloads `GET /plans/:reference`; the API reconstructs canonical Markdown from database rows.
6. MCP `list_plans` calls `GET /plans` and presents metadata to the agent.
7. On an explicit user deletion request, MCP `delete_plan` calls `DELETE /plans/:reference`; SQLite cascades deletion to components and items.

## Environment Map

| Variable | Owner | Default | Purpose |
|---|---|---|---|
| `PLANNER_DB_PATH` | API | `planner.sqlite` | SQLite file path; `:memory:` is useful for tests |
| `PLANNER_API_HOST` | API | `127.0.0.1` | Bind host |
| `PLANNER_API_PORT` | API | `3000` | Bind port |
| `PLANNER_API_URL` | MCP and scripts | `http://127.0.0.1:3000` | REST API base URL |

## Extension Points

- Add domain fields first in `domain.ts`, then parser/formatter, migration/schema, repository mapping, routes, and tests.
- Add REST operations through `server.ts`; keep persistence out of route handlers.
- Add MCP tools through `server.ts` and transport behavior through `api-client.ts`.
- Add future packages under `packages/*`; npm workspaces discover them automatically.
- Introduce explicit database migrations before changing a schema used by released persistent databases.

## Test Map

| Layer | Evidence |
|---|---|
| Unit | Markdown parsing, classification field mapping, and canonical round-trip |
| Integration | SQLite create/update/retrieve and Fastify route behavior |
| MCP integration | REST client errors, destructive tool metadata, and MCP in-memory transport tool invocation |
| End-to-end | Real HTTP listener plus shell upload/download/sync scripts |
