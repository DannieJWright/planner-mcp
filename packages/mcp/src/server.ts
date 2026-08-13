import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PlannerApiClient } from "./api-client.js";

export function createMcpServer(client = new PlannerApiClient()): McpServer {
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

  return server;
}
