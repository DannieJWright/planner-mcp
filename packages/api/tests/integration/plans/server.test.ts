import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { formatPlanMarkdown, parsePlanMarkdown } from "../../../src/plans/markdown.js";
import { PlanRepository } from "../../../src/plans/repository.js";
import { createServer } from "../../../src/server.js";
import { samplePlan } from "../../fixtures/sample-plan.js";

const resources: Array<{ app: FastifyInstance; repository: PlanRepository }> = [];

afterEach(async () => {
  for (const { app, repository } of resources.splice(0)) {
    await app.close();
    repository.close();
  }
});

describe("REST API", () => {
  it("uploads, lists, downloads, and updates plans", async () => {
    const repository = new PlanRepository(":memory:");
    const app = createServer({ repository });
    resources.push({ app, repository });
    const upload = await app.inject({ method: "PUT", url: "/plans", headers: { "content-type": "text/markdown" }, payload: formatPlanMarkdown(samplePlan) });
    expect(upload.statusCode).toBe(200);
    const uploadBody = upload.json<{ reference: string; validationFailures: { ordering: unknown[] } }>();
    const reference = uploadBody.reference;
    expect(uploadBody.validationFailures).toEqual({ ordering: [] });

    const list = await app.inject({ method: "GET", url: "/plans" });
    expect(list.json()).toMatchObject({ plans: [{ reference, title: samplePlan.title }] });

    const download = await app.inject({ method: "GET", url: `/plans/${reference}` });
    expect(download.headers["content-type"]).toContain("text/markdown");
    expect(parsePlanMarkdown(download.body).reference).toBe(reference);

    const updated = { ...samplePlan, reference, title: "Updated analytics" };
    const update = await app.inject({ method: "PUT", url: "/plans", headers: { "content-type": "text/markdown" }, payload: formatPlanMarkdown(updated) });
    expect(update.json()).toMatchObject({ reference, validationFailures: { ordering: [] } });
    expect(repository.get(reference)?.title).toBe("Updated analytics");
  });

  it("persists renumbered Markdown and reports unresolved references", async () => {
    const repository = new PlanRepository(":memory:");
    const app = createServer({ repository });
    resources.push({ app, repository });
    const plan = {
      ...samplePlan,
      components: [{
        ...samplePlan.components[0]!,
        ref: "COMP-4",
        requirements: [{ ref: "4.A", title: "Requirement 4.A", details: "See requirement 4.A and potato 8.Z." }],
      }],
      actionItems: [],
    };

    const upload = await app.inject({ method: "PUT", url: "/plans", headers: { "content-type": "text/markdown" }, payload: formatPlanMarkdown(plan) });
    expect(upload.statusCode).toBe(200);
    expect(upload.json()).toMatchObject({
      validationFailures: { ordering: [{ section: "Requirement 1.A", failure: "potato 8.Z" }] },
    });
    const reference = upload.json<{ reference: string }>().reference;
    const stored = repository.get(reference)!;
    expect(stored.components[0]?.ref).toBe("COMP-1");
    expect(stored.components[0]?.requirements[0]).toMatchObject({ ref: "1.A", details: "See requirement 1.A and potato 8.Z." });

    const download = await app.inject({ method: "GET", url: `/plans/${reference}` });
    expect(download.body).toContain("## **COMP-1 -");
    expect(download.body).toContain("See requirement 1.A and potato 8.Z.");
  });

  it("returns useful client errors", async () => {
    const repository = new PlanRepository(":memory:");
    const app = createServer({ repository });
    resources.push({ app, repository });
    expect((await app.inject({ method: "GET", url: "/plans/missing" })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: "/plans", headers: { "content-type": "text/markdown" }, payload: "invalid" })).statusCode).toBe(400);

    const invalidPlan = formatPlanMarkdown(samplePlan).replace("**Status:** Open\n\nChoose batch", "Choose batch");
    const response = await app.inject({ method: "PUT", url: "/plans", headers: { "content-type": "text/markdown" }, payload: invalidPlan });
    expect(response.json()).toEqual({
      error: expect.stringContaining("Decision 1.A has missing required status. Add `**Status:** Open`"),
    });
  });

  it("deletes a plan by reference", async () => {
    const repository = new PlanRepository(":memory:");
    const app = createServer({ repository });
    resources.push({ app, repository });
    const reference = repository.save(samplePlan);

    expect((await app.inject({ method: "DELETE", url: `/plans/${reference}` })).statusCode).toBe(204);
    expect(repository.get(reference)).toBeUndefined();
    expect((await app.inject({ method: "DELETE", url: `/plans/${reference}` })).statusCode).toBe(404);
  });
});
