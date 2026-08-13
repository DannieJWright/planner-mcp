import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PlannerApiClient } from "./api-client.js";

type PlannerClient = Pick<PlannerApiClient, "listPlans" | "deletePlan">;

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

  return server;
}
