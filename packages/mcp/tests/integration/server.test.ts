import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpServer } from "../../src/server.js";

const closers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const closer of closers.splice(0)) await closer.close();
});

describe("MCP server", () => {
  it("exposes list_plans over MCP transport", async () => {
    const api = { listPlans: vi.fn().mockResolvedValue([{ reference: "PLAN-1", title: "One", description: "A plan", tags: ["test"], status: "Draft" }]) };
    const server = createMcpServer(api);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(client, server);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("list_plans");
    const result = await client.callTool({ name: "list_plans", arguments: {} });
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("PLAN-1") }]);
    expect(api.listPlans).toHaveBeenCalledOnce();
  });
});
