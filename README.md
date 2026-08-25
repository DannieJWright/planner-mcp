# Planner MCP Monorepo

A TypeScript monorepo for turning planning documents into structured SQLite data and exposing plan metadata to AI agents through MCP.

## Repository Map

| Path | Responsibility |
|---|---|
| `packages/api` | Markdown parser/formatter, domain types, SQLite repository, and REST API |
| `packages/mcp` | MCP stdio server and REST API client |
| `skills/idea-planner` | Phase-gated brain-dump planning skill and direct transfer scripts |
| `docs/REPOSITORY_MAP.md` | Detailed ownership, data flow, and extension map |
| `AGENTS.md` | Working rules and verification guidance for coding agents |

## Requirements

- Node.js 22.5 or newer; SQLite is provided by Node's built-in `node:sqlite` module
- npm 10 or newer
- `curl` for the skill's shell scripts

## Setup

```sh
npm install
npm run check
```

## Run

Start the API in one terminal:

```sh
PLANNER_DB_PATH=planner.sqlite npm run dev:api
```

The API defaults to `http://127.0.0.1:3000`.

Start the MCP stdio server from an MCP client configuration:

```json
{
  "mcpServers": {
    "planner": {
      "command": "npm",
      "args": ["run", "dev:mcp"],
      "cwd": "/absolute/path/to/planner-mcp",
      "env": {
        "PLANNER_API_URL": "http://127.0.0.1:3000"
      }
    }
  }
}
```

Example local use in opencode.json/opencode.jsonc
```json
"mcp": {
  "planner": {
    "type": "local",
    "enabled": true,
    "command": ["npm", "run", "dev:mcp"],
    "cwd": "/home/nhbody/git/planner-mcp",
    "environment": {
      "PLANNER_API_URL": "http://127.0.0.1:3000"
    }
  }
}
```

## REST API

| Method | Endpoint | Behavior |
|---|---|---|
| `GET` | `/health` | Readiness response |
| `PUT` | `/plans` | Parse, normalize, and add/update a Markdown plan; returns its reference and ordering validation failures |
| `GET` | `/plans` | List plan frontmatter metadata |
| `GET` | `/plans/:reference` | Reconstruct canonical Markdown |
| `PATCH` | `/plans/:reference` | Merge a *partial* Markdown document into a persisted plan |
| `DELETE` | `/plans/:reference` | Delete a plan and all associated sections |
| `DELETE` | `/plans/:reference/components/:componentRef` | Remove one component, renumber the plan, and persist it |
| `GET` | `/plans/:reference/knowledge-gaps` | Knowledge gaps for one plan, grouped by component |
| `GET` | `/plans/:reference/decisions` | Decisions for one plan, grouped by component |

`PUT /plans` requires `Content-Type: text/markdown`. A frontmatter reference of `New` creates a UUID-backed `PLAN-...` reference. Any other reference updates that plan transactionally.

Write responses have the shape `{ "reference": "...", "validationFailures": { "ordering": [] }, "referenceChanges": { "shifted": false, "changes": [] } }`. Ordering failures identify unresolved reference-like text by its normalized containing section; unresolved text is preserved in the saved plan.

`referenceChanges` reports how normalization moved references during the write. Each entry is `renamed` (with `from`/`to`), `removed` (with `from`), or `added` (with the assigned `to` plus the correlating `handle`, `title`, and owning `parent`). `shifted` is true when anything was renamed or removed, meaning references a caller already holds are stale and the plan should be re-downloaded. Adding a node never sets `shifted`.

### Partial plan documents

`PATCH /plans/:reference` accepts a partial plan document: a Markdown plan document that may omit anything that is not changing. It requires `Content-Type: text/markdown` and the persisted plan reference in its frontmatter.

- `# Components` / `# Action Items` root headings and the six component subsections are all optional.
- Nodes are matched to the stored plan by canonical reference. Nodes that are absent from the document are left untouched and are never deleted or reordered as a side effect.
- `COMP-New`, `ACTION-New`, and `Requirement New` (and the equivalent for every item kind) create new nodes. A reference that does not exist is upserted rather than rejected.
- Nodes may carry leading metadata fields:

| Field | Applies to | Meaning |
|---|---|---|
| `**Status:** <value>` | decisions, knowledge gaps, action items | set the node status |
| `**Delete:** true` | any node | remove this node |
| `**Replace:** true` | components | the supplied items become the component's complete child set |
| `**Position:** <n>` | components, action items | move to this 1-based index |
| `**Handle:** <token>` | new nodes | correlation token echoed back in `referenceChanges` |

Unknown metadata keys are rejected so typos fail loudly. Ambiguous positions resolve gracefully: positions apply in ascending order, out-of-range values clamp to the list bounds, duplicates resolve by document order, and unpositioned nodes keep their relative order.

```markdown
---
reference: PLAN-d440b883-a3cf-4aa2-bf85-929ac56bf3cb
---

## **COMP-4 - Open decisions retrieval tool + endpoint**

**Position:** 1
```

### Item retrieval

`GET /plans/:reference/knowledge-gaps` and `GET /plans/:reference/decisions` accept `status` and `format` query parameters. `status` defaults to `Open` and accepts the item's model statuses (`Open|Resolved|Closed` and `Open|Decided|Closed` respectively) plus `all`. `format` defaults to `json` and also accepts `markdown`, which returns an items-only excerpt rather than a full plan document. Results are grouped by component and ordered by ascending canonical reference; a valid plan with no matches returns an empty result, and an unknown plan returns `404`.

## Direct Plan Transfer

The scripts stream files directly to and from the API to avoid duplicating plan content in an agent context:

```sh
skills/idea-planner/scripts/upload-plan.sh path/to/plan.md
skills/idea-planner/scripts/download-plan.sh PLAN-id path/to/plan.md
skills/idea-planner/scripts/sync-plan.sh path/to/plan.md
```

Set `PLANNER_API_URL` to override the default API URL. `sync-plan.sh` uploads, captures the reference, and atomically replaces the local document with canonical Markdown containing that reference.

## MCP Surface

| Tool | Purpose |
|---|---|
| `list_plans` | Saved plans and their metadata |
| `delete_plan` | Permanently delete a plan and its sections (destructive; explicit user request only) |
| `upload_plan` | Submit plan Markdown directly. `mode: "full"` replaces a whole plan; `mode: "partial"` merges a partial document into the plan named by `reference` |
| `remove_component` | Remove one component by canonical reference, renumbering the rest (destructive) |
| `list_open_knowledge_gaps` | Knowledge gaps for one plan, filtered by `status` (default `Open`) in `json` or `markdown` |
| `list_open_decisions` | Decisions for one plan, filtered by `status` (default `Open`) in `json` or `markdown` |

`delete_plan` and `remove_component` are destructive and must only be invoked after an explicit user request.

`upload_plan` and `remove_component` return `referencesShifted` / `resyncRequired` plus the full `referenceChanges` list and an `added` list carrying the references assigned to new nodes. When `resyncRequired` is true, re-download the canonical Markdown before issuing any further reference-based operation. Neither tool returns the plan's canonical Markdown.

These tools are additive: the shell scripts remain the supported path for bulk Markdown upload and download.

## Verification

```sh
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
npm run check
```

Tests use in-memory or temporary SQLite databases and do not touch `planner.sqlite`.
