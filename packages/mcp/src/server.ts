import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PlannerApiClient, type ItemQueryResult, type PlanWriteResult, type ReferenceChange } from "./api-client.js";

type PlannerClient = Pick<
  PlannerApiClient,
  "listPlans" | "deletePlan" | "uploadPlan" | "patchPlan" | "removeComponent" | "listKnowledgeGaps" | "listDecisions"
>;

const additiveNote = "This tool complements, and does not replace, the Markdown file workflow driven by the planner skill scripts (upload-plan.sh / download-plan.sh / sync-plan.sh), which remains the supported path for bulk plan submission.";

const resyncNote = "When `resyncRequired` is true, references you already hold are stale: re-download the canonical plan Markdown before issuing any further reference-based operation.";

function describeChange(change: ReferenceChange): string {
  if (change.change === "renamed") return `${change.from} -> ${change.to}`;
  if (change.change === "removed") return `${change.from} (removed)`;
  return change.handle ? `${change.to} (handle: ${change.handle})` : `${change.to} (${change.title})`;
}

function summarize(action: string, result: PlanWriteResult): { text: string; structuredContent: Record<string, unknown> } {
  const changes = result.referenceChanges?.changes ?? [];
  const shifted = result.referenceChanges?.shifted ?? false;
  const added = changes.filter((change) => change.change === "added").map((change) => {
    const entry: { to: string; handle?: string; title: string; parent?: string } = { to: change.to, title: change.title };
    if (change.handle !== undefined) entry.handle = change.handle;
    if (change.parent !== undefined) entry.parent = change.parent;
    return entry;
  });
  const moved = changes.filter((change) => change.change !== "added");
  const failures = result.validationFailures?.ordering ?? [];

  const lines = [`${action} plan ${result.reference}.`];
  if (shifted) lines.push(`References changed; re-download the plan before using stored references. ${moved.map(describeChange).join(", ")}`);
  if (added.length > 0) lines.push(`Added: ${added.map((entry) => (entry.handle ? `${entry.to} (handle: ${entry.handle})` : `${entry.to} (${entry.title})`)).join(", ")}`);
  if (failures.length > 0) lines.push(`Warning: unresolved references remain: ${failures.map((failure) => `${failure.section}: ${failure.failure}`).join("; ")}`);

  return {
    text: lines.join("\n"),
    structuredContent: {
      reference: result.reference,
      saved: true,
      referencesShifted: shifted,
      resyncRequired: shifted,
      referenceChanges: changes,
      added,
      validationFailures: result.validationFailures ?? { ordering: [] },
    },
  };
}

export function createMcpServer(client: PlannerClient = new PlannerApiClient()): McpServer {
  const server = new McpServer({ name: "planner-mcp", version: "0.1.0" });

  server.tool(
    "list_plans",
    "List saved project plans and their metadata from the Planner REST API.",
    {},
    async () => {
      const plans = await client.listPlans();
      return {
        content: [{ type: "text", text: JSON.stringify(plans, null, 2) }],
        structuredContent: { plans },
      };
    },
  );

  server.tool(
    "delete_plan",
    "Permanently delete a saved plan and all associated sections by reference. Invoke only when the user explicitly requests deletion; never invoke proactively or automatically.",
    { reference: z.string().min(1).describe("The exact persisted plan reference to delete") },
    { destructiveHint: true, idempotentHint: true, readOnlyHint: false },
    async ({ reference }) => {
      await client.deletePlan(reference);
      return {
        content: [{ type: "text", text: `Deleted plan ${reference}.` }],
        structuredContent: { reference, deleted: true },
      };
    },
  );

  server.tool(
    "upload_plan",
    [
      "Submit plan content as Markdown directly, without writing or uploading a Markdown file.",
      "`mode: \"full\"` ingests a complete plan document (frontmatter `reference: New` creates a plan, a persisted reference replaces it).",
      "`mode: \"partial\"` merges a partial document into the persisted plan identified by `reference`: only the nodes present in the document are touched, omitted nodes are left untouched, `New` references create nodes, and nodes may carry `**Delete:** true`, `**Replace:** true`, `**Position:** n`, and `**Handle:** token` metadata fields.",
      resyncNote,
      additiveNote,
    ].join(" "),
    {
      markdown: z.string().min(1).describe("The plan document. A full plan document in `full` mode; a partial plan document in `partial` mode."),
      reference: z.string().min(1).optional().describe("The persisted plan reference. Required in `partial` mode."),
      mode: z.enum(["full", "partial"]).default("full").describe("`full` replaces the whole plan; `partial` merges only the supplied nodes."),
    },
    { readOnlyHint: false, idempotentHint: false },
    async ({ markdown, reference, mode }) => {
      const selected = mode ?? "full";
      if (selected === "partial" && !reference) {
        return {
          isError: true,
          content: [{ type: "text", text: "A partial upload requires the persisted plan `reference`." }],
        };
      }
      const result = selected === "partial" ? await client.patchPlan(reference!, markdown) : await client.uploadPlan(markdown);
      const summary = summarize("Saved", result);
      return {
        content: [{ type: "text", text: summary.text }],
        structuredContent: summary.structuredContent,
      };
    },
  );

  server.tool(
    "remove_component",
    [
      "Remove a component from a saved plan by its canonical component reference.",
      "The remaining plan is renumbered and persisted, so component and item references below the removed component shift.",
      resyncNote,
      additiveNote,
    ].join(" "),
    {
      reference: z.string().min(1).describe("The persisted plan reference, for example `PLAN-<uuid>`"),
      component: z.string().min(1).describe("The canonical component reference to remove, for example `COMP-2`"),
    },
    { destructiveHint: true, idempotentHint: false, readOnlyHint: false },
    async ({ reference, component }) => {
      const result = await client.removeComponent(reference, component);
      const summary = summarize("Updated", result);
      return {
        content: [{ type: "text", text: summary.text }],
        structuredContent: summary.structuredContent,
      };
    },
  );

  const registerRetrievalTool = (
    name: string,
    subject: string,
    statuses: readonly [string, ...string[]],
    call: (reference: string, options: { status?: string; format?: "json" | "markdown" }) => Promise<ItemQueryResult | string>,
  ): void => {
    server.tool(
      name,
      [
        `Retrieve the ${subject} for one saved plan, grouped by component and ordered by ascending canonical reference.`,
        `Defaults to \`status: "${statuses[0]}"\`; pass \`all\` for every status.`,
        "A plan with no matching items returns an empty result rather than an error.",
        additiveNote,
      ].join(" "),
      {
        reference: z.string().min(1).describe("The persisted plan reference, for example `PLAN-<uuid>`"),
        status: z.enum([...statuses, "all"] as [string, ...string[]]).optional().describe(`Status filter. Defaults to \`${statuses[0]}\`.`),
        format: z.enum(["json", "markdown"]).optional().describe("`json` (default) returns grouped structured data; `markdown` returns an items-only excerpt."),
      },
      { readOnlyHint: true, idempotentHint: true },
      async ({ reference, status, format }) => {
        const options: { status?: string; format?: "json" | "markdown" } = {};
        if (status !== undefined) options.status = status;
        if (format !== undefined) options.format = format;
        const result = await call(reference, options);
        if (typeof result === "string") return { content: [{ type: "text", text: result }] };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      },
    );
  };

  registerRetrievalTool("list_open_knowledge_gaps", "knowledge gaps", ["Open", "Resolved", "Closed"], (reference, options) => client.listKnowledgeGaps(reference, options));
  registerRetrievalTool("list_open_decisions", "decisions", ["Open", "Decided", "Closed"], (reference, options) => client.listDecisions(reference, options));

  return server;
}
