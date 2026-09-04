import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { decisionStatuses } from "../../../api/src/plans/models/decision.js";
import { knowledgeGapStatuses } from "../../../api/src/plans/models/knowledgeGap.js";
import { createMcpServer } from "../../src/server.js";

/**
 * Cross-package vocabulary consistency: the retrieval tools' status enums must stay in lockstep with
 * the API descriptors that own those values. `server.ts` imports those arrays from @planner/api; this
 * test verifies they surface unchanged through the generated tool schemas.
 */

const noopClient = {
  listPlans: async () => [],
  deletePlan: async () => undefined,
  uploadPlan: async () => ({ reference: "PLAN-1", validationFailures: { ordering: [] }, referenceChanges: { shifted: false, changes: [] } }),
  patchPlan: async () => ({ reference: "PLAN-1", validationFailures: { ordering: [] }, referenceChanges: { shifted: false, changes: [] } }),
  removeComponent: async () => ({ reference: "PLAN-1", validationFailures: { ordering: [] }, referenceChanges: { shifted: false, changes: [] } }),
  listKnowledgeGaps: async () => ({ plan: {}, components: [] }),
  listDecisions: async () => ({ plan: {}, components: [] }),
};

const clients: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
});

async function statusEnum(toolName: string): Promise<string[]> {
  const server = createMcpServer(noopClient as never);
  const client = new Client({ name: "vocabulary-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  clients.push(client, server as unknown as { close(): Promise<void> });

  const tool = (await client.listTools()).tools.find((entry) => entry.name === toolName);
  expect(tool).toBeDefined();
  const status = (tool!.inputSchema.properties as Record<string, { enum?: string[]; anyOf?: Array<{ enum?: string[] }> }>).status!;
  if (status.enum) return status.enum;
  const wrapped = status.anyOf?.find((option) => option.enum)?.enum;
  expect(wrapped, `no status enum found on tool ${toolName}`).toBeDefined();
  return wrapped!;
}

describe("retrieval tools expose the API's status vocabulary", () => {
  it("list_open_knowledge_gaps accepts exactly the knowledge-gap statuses plus all", async () => {
    await expect(statusEnum("list_open_knowledge_gaps")).resolves.toEqual([...knowledgeGapStatuses, "all"]);
  });

  it("list_open_decisions accepts exactly the decision statuses plus all", async () => {
    await expect(statusEnum("list_open_decisions")).resolves.toEqual([...decisionStatuses, "all"]);
  });
});
