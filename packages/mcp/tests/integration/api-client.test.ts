import { describe, expect, it, vi } from "vitest";
import { PlannerApiClient } from "../../src/api-client.js";

describe("PlannerApiClient", () => {
  it("returns REST plan metadata", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ plans: [{ reference: "PLAN-1", title: "One", description: "", tags: [], status: "Draft" }] }), { status: 200 }));
    const plans = await new PlannerApiClient("http://api.test", fetcher).listPlans();
    expect(fetcher).toHaveBeenCalledWith("http://api.test/plans");
    expect(plans[0]?.reference).toBe("PLAN-1");
  });

  it("surfaces REST failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(new PlannerApiClient("http://api.test", fetcher).listPlans()).rejects.toThrow("503: unavailable");
  });

  it("deletes a plan by its encoded reference", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await new PlannerApiClient("http://api.test", fetcher).deletePlan("PLAN/1");
    expect(fetcher).toHaveBeenCalledWith("http://api.test/plans/PLAN%2F1", { method: "DELETE" });
  });

  it("surfaces delete failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("not found", { status: 404 }));
    await expect(new PlannerApiClient("http://api.test", fetcher).deletePlan("PLAN-1")).rejects.toThrow("404: not found");
  });
});

describe("PlannerApiClient plan writes", () => {
  const writeResult = { reference: "PLAN-1", validationFailures: { ordering: [] }, referenceChanges: { shifted: false, changes: [] } };

  it("uploads a full plan document as Markdown", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(writeResult), { status: 200 }));
    const result = await new PlannerApiClient("http://api.test", fetcher).uploadPlan("# doc");
    expect(fetcher).toHaveBeenCalledWith("http://api.test/plans", { method: "PUT", headers: { "content-type": "text/markdown" }, body: "# doc" });
    expect(result).toEqual(writeResult);
  });

  it("patches a plan with a partial document at its encoded reference", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(writeResult), { status: 200 }));
    await new PlannerApiClient("http://api.test", fetcher).patchPlan("PLAN/1", "# partial");
    expect(fetcher).toHaveBeenCalledWith("http://api.test/plans/PLAN%2F1", { method: "PATCH", headers: { "content-type": "text/markdown" }, body: "# partial" });
  });

  it("removes a component through the nested sub-resource", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(writeResult), { status: 200 }));
    await new PlannerApiClient("http://api.test", fetcher).removeComponent("PLAN-1", "COMP 2");
    expect(fetcher).toHaveBeenCalledWith("http://api.test/plans/PLAN-1/components/COMP%202", { method: "DELETE" });
  });

  it("surfaces write failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("bad document", { status: 400 }));
    await expect(new PlannerApiClient("http://api.test", fetcher).patchPlan("PLAN-1", "x")).rejects.toThrow("400: bad document");
    await expect(new PlannerApiClient("http://api.test", fetcher).removeComponent("PLAN-1", "COMP-9")).rejects.toThrow("400: bad document");
    await expect(new PlannerApiClient("http://api.test", fetcher).uploadPlan("x")).rejects.toThrow("400: bad document");
  });
});

describe("PlannerApiClient item retrieval", () => {
  const items = { plan: { reference: "PLAN-1", title: "One" }, components: [{ ref: "COMP-1", title: "T", items: [] }] };

  it("requests knowledge gaps without query parameters by default", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(items), { status: 200 }));
    const result = await new PlannerApiClient("http://api.test", fetcher).listKnowledgeGaps("PLAN-1");
    expect(fetcher).toHaveBeenCalledWith("http://api.test/plans/PLAN-1/knowledge-gaps");
    expect(result).toEqual(items);
  });

  it("passes status and format through as query parameters", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(items), { status: 200 }));
    await new PlannerApiClient("http://api.test", fetcher).listDecisions("PLAN/1", { status: "all", format: "json" });
    expect(fetcher).toHaveBeenCalledWith("http://api.test/plans/PLAN%2F1/decisions?status=all&format=json");
  });

  it("returns the raw body for markdown requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("# PLAN-1 - One\n", { status: 200 }));
    const result = await new PlannerApiClient("http://api.test", fetcher).listKnowledgeGaps("PLAN-1", { format: "markdown" });
    expect(fetcher).toHaveBeenCalledWith("http://api.test/plans/PLAN-1/knowledge-gaps?format=markdown");
    expect(result).toBe("# PLAN-1 - One\n");
  });

  it("surfaces retrieval failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("not found", { status: 404 }));
    await expect(new PlannerApiClient("http://api.test", fetcher).listDecisions("PLAN-1")).rejects.toThrow("404: not found");
  });
});
