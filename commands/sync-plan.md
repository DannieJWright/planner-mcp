---
description: Sync a Markdown plan with the idea planner MCP server
---

# Sync Plan

Sync the current plan Markdown file with the idea planner MCP server by invoking:

```sh
skills/idea-planner/scripts/sync-plan.sh "<plan-file>"
```

Replace `<plan-file>` with the current plan Markdown file being worked on. The supplied plan file path is:

$ARGUMENTS

If the plan Markdown file is unknown, stop and ask the user which file to sync. After invoking the script, stop; do not make further changes or continue with implementation.
