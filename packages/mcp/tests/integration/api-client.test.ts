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
