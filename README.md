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
| `PUT` | `/plans` | Parse and add/update a Markdown plan; returns `{ "reference": "..." }` |
| `GET` | `/plans` | List plan frontmatter metadata |
| `GET` | `/plans/:reference` | Reconstruct canonical Markdown |
| `DELETE` | `/plans/:reference` | Delete a plan and all associated sections |

`PUT /plans` requires `Content-Type: text/markdown`. A frontmatter reference of `New` creates a UUID-backed `PLAN-...` reference. Any other reference updates that plan transactionally.

## Direct Plan Transfer

The scripts stream files directly to and from the API to avoid duplicating plan content in an agent context:

```sh
skills/idea-planner/scripts/upload-plan.sh path/to/plan.md
skills/idea-planner/scripts/download-plan.sh PLAN-id path/to/plan.md
skills/idea-planner/scripts/sync-plan.sh path/to/plan.md
```

Set `PLANNER_API_URL` to override the default API URL. `sync-plan.sh` uploads, captures the reference, and atomically replaces the local document with canonical Markdown containing that reference.

## MCP Surface

The MCP server exposes `list_plans`, which returns saved plans and metadata, and `delete_plan`, which permanently deletes a plan and its associated sections. `delete_plan` is destructive and must only be invoked after an explicit user request to delete that plan. Use the shell scripts for bulk Markdown upload and download.

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
