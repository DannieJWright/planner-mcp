import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpServer } from "../../src/server.js";

const closers: Array<{ close(): Promise<void> }> = [];

const noopClient = {
  listPlans: vi.fn(),
  deletePlan: vi.fn(),
  uploadPlan: vi.fn(),
  patchPlan: vi.fn(),
  removeComponent: vi.fn(),
  listKnowledgeGaps: vi.fn(),
  listDecisions: vi.fn(),
};

async function connect(overrides: Partial<typeof noopClient> = {}) {
  const api = { ...noopClient, ...overrides } as typeof noopClient;
  const server = createMcpServer(api);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(client, server);
  return { api, client };
}

afterEach(async () => {
  for (const closer of closers.splice(0)) await closer.close();
});

describe("MCP server", () => {
  it("exposes list_plans over MCP transport", async () => {
    const { api, client } = await connect({ listPlans: vi.fn().mockResolvedValue([{ reference: "PLAN-1", title: "One", description: "A plan", tags: ["test"], status: "Draft" }]) });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("list_plans");
    const result = await client.callTool({ name: "list_plans", arguments: {} });
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("PLAN-1") }]);
    expect(api.listPlans).toHaveBeenCalledOnce();
  });

  it("exposes delete_plan as an explicitly requested destructive tool", async () => {
    const { api, client } = await connect({ deletePlan: vi.fn().mockResolvedValue(undefined) });

    const tools = await client.listTools();
    const tool = tools.tools.find(({ name }) => name === "delete_plan");
    expect(tool).toMatchObject({ annotations: { destructiveHint: true, idempotentHint: true, readOnlyHint: false } });
    expect(tool?.description).toContain("only when the user explicitly requests deletion");

    const result = await client.callTool({ name: "delete_plan", arguments: { reference: "PLAN-1" } });
    expect(result.structuredContent).toEqual({ reference: "PLAN-1", deleted: true });
    expect(api.deletePlan).toHaveBeenCalledWith("PLAN-1");
  });
});

const writeResult = (overrides: Record<string, unknown> = {}) => ({
  reference: "PLAN-1",
  validationFailures: { ordering: [] },
  referenceChanges: { shifted: false, changes: [] },
  ...overrides,
});

describe("upload_plan", () => {
  it("documents that a partial node body is replaced wholesale, not appended", async () => {
    const { client } = await connect();
    const tool = (await client.listTools()).tools.find(({ name }) => name === "upload_plan");
    expect(tool?.description).toContain("does not append");
    expect(tool?.description).toContain("replaced wholesale");
    expect(tool?.description).toContain("is removed, not preserved");
  });

  it("defaults to full mode and calls uploadPlan", async () => {
    const { api, client } = await connect({ uploadPlan: vi.fn().mockResolvedValue(writeResult()) });
    const tools = await client.listTools();
    const tool = tools.tools.find(({ name }) => name === "upload_plan");
    expect(tool).toMatchObject({ annotations: { readOnlyHint: false, idempotentHint: false } });
    expect(tool?.description).toContain("does not replace, the Markdown file workflow");

    const result = await client.callTool({ name: "upload_plan", arguments: { markdown: "# doc" } });
    expect(api.uploadPlan).toHaveBeenCalledWith("# doc");
    expect(api.patchPlan).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({ reference: "PLAN-1", saved: true, referencesShifted: false, resyncRequired: false, added: [] });
    expect(result.content).toEqual([{ type: "text", text: "Saved plan PLAN-1." }]);
  });

  it("routes partial mode to patchPlan and signals a required resync", async () => {
    const changes = [
      { change: "renamed", kind: "component", from: "COMP-3", to: "COMP-1" },
      { change: "renamed", kind: "requirements", from: "2.C", to: "2.B" },
    ];
    const { api, client } = await connect({ patchPlan: vi.fn().mockResolvedValue(writeResult({ referenceChanges: { shifted: true, changes } })) });

    const result = await client.callTool({ name: "upload_plan", arguments: { markdown: "# partial", reference: "PLAN-1", mode: "partial" } });
    expect(api.patchPlan).toHaveBeenCalledWith("PLAN-1", "# partial");
    expect(result.structuredContent).toMatchObject({ referencesShifted: true, resyncRequired: true, referenceChanges: changes });
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("COMP-3 -> COMP-1, 2.C -> 2.B") }]);
  });

  it("reports the references assigned to added nodes", async () => {
    const changes = [
      { change: "added", kind: "component", to: "COMP-5", handle: "audit", title: "Audit logging" },
      { change: "added", kind: "requirements", to: "5.A", title: "Every mutation writes an audit row", parent: "COMP-5" },
    ];
    const { client } = await connect({ patchPlan: vi.fn().mockResolvedValue(writeResult({ referenceChanges: { shifted: false, changes } })) });

    const result = await client.callTool({ name: "upload_plan", arguments: { markdown: "# partial", reference: "PLAN-1", mode: "partial" } });
    expect(result.structuredContent).toMatchObject({
      resyncRequired: false,
      added: [
        { to: "COMP-5", handle: "audit", title: "Audit logging" },
        { to: "5.A", title: "Every mutation writes an audit row", parent: "COMP-5" },
      ],
    });
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("Added: COMP-5 (handle: audit), 5.A (Every mutation writes an audit row)") }]);
  });

  it("warns about unresolved references without returning canonical Markdown", async () => {
    const { client } = await connect({ uploadPlan: vi.fn().mockResolvedValue(writeResult({ validationFailures: { ordering: [{ section: "Note 1.A", failure: "potato 8.Z" }] } })) });
    const result = await client.callTool({ name: "upload_plan", arguments: { markdown: "# doc" } });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("Warning: unresolved references remain: Note 1.A: potato 8.Z");
    expect(text).not.toContain("# Components");
  });

  it("refuses a partial upload without a reference", async () => {
    const { api, client } = await connect();
    const result = await client.callTool({ name: "upload_plan", arguments: { markdown: "# partial", mode: "partial" } });
    expect(result.isError).toBe(true);
    expect(api.patchPlan).not.toHaveBeenCalled();
  });
});

describe("remove_component", () => {
  it("is marked destructive and reports shifted references", async () => {
    const changes = [
      { change: "renamed", kind: "component", from: "COMP-3", to: "COMP-2" },
      { change: "removed", kind: "component", from: "COMP-2" },
    ];
    const { api, client } = await connect({ removeComponent: vi.fn().mockResolvedValue(writeResult({ referenceChanges: { shifted: true, changes } })) });

    const tools = await client.listTools();
    expect(tools.tools.find(({ name }) => name === "remove_component")).toMatchObject({
      annotations: { destructiveHint: true, idempotentHint: false, readOnlyHint: false },
    });

    const result = await client.callTool({ name: "remove_component", arguments: { reference: "PLAN-1", component: "COMP-2" } });
    expect(api.removeComponent).toHaveBeenCalledWith("PLAN-1", "COMP-2");
    expect(result.structuredContent).toMatchObject({ resyncRequired: true, referencesShifted: true, referenceChanges: changes });
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("COMP-3 -> COMP-2, COMP-2 (removed)") }]);
  });
});

describe("retrieval tools", () => {
  const grouped = { plan: { reference: "PLAN-1", title: "One" }, components: [{ ref: "COMP-1", title: "T", items: [{ ref: "1.A", title: "Gap", details: "d", status: "Open" }] }] };

  it("exposes read-only knowledge gap retrieval and passes filters through", async () => {
    const { api, client } = await connect({ listKnowledgeGaps: vi.fn().mockResolvedValue(grouped) });
    const tools = await client.listTools();
    const tool = tools.tools.find(({ name }) => name === "list_open_knowledge_gaps");
    expect(tool).toMatchObject({ annotations: { readOnlyHint: true } });
    expect(tool?.description).toContain('Defaults to `status: "Open"`');

    const result = await client.callTool({ name: "list_open_knowledge_gaps", arguments: { reference: "PLAN-1", status: "all" } });
    expect(api.listKnowledgeGaps).toHaveBeenCalledWith("PLAN-1", { status: "all" });
    expect(result.structuredContent).toEqual(grouped);
  });

  it("omits absent options and returns a raw Markdown excerpt", async () => {
    const { api, client } = await connect({ listDecisions: vi.fn().mockResolvedValue("# PLAN-1 - One\n") });
    const bare = await connect({ listDecisions: vi.fn().mockResolvedValue(grouped) });
    await bare.client.callTool({ name: "list_open_decisions", arguments: { reference: "PLAN-1" } });
    expect(bare.api.listDecisions).toHaveBeenCalledWith("PLAN-1", {});

    const result = await client.callTool({ name: "list_open_decisions", arguments: { reference: "PLAN-1", format: "markdown" } });
    expect(api.listDecisions).toHaveBeenCalledWith("PLAN-1", { format: "markdown" });
    expect(result.content).toEqual([{ type: "text", text: "# PLAN-1 - One\n" }]);
    expect(result.structuredContent).toBeUndefined();
  });

  it("rejects a status that is invalid for the item kind", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "list_open_decisions", arguments: { reference: "PLAN-1", status: "Resolved" } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("Expected 'Open' | 'Decided' | 'Closed' | 'all'") }]);
  });
});
