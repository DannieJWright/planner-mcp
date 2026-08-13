import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { formatPlanMarkdown, parsePlanMarkdown } from "../../src/markdown.js";
import { PlanRepository } from "../../src/repository.js";
import { createServer } from "../../src/server.js";
import { samplePlan } from "../fixtures/sample-plan.js";

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
    const reference = upload.json<{ reference: string }>().reference;

    const list = await app.inject({ method: "GET", url: "/plans" });
    expect(list.json()).toMatchObject({ plans: [{ reference, title: samplePlan.title }] });

    const download = await app.inject({ method: "GET", url: `/plans/${reference}` });
    expect(download.headers["content-type"]).toContain("text/markdown");
    expect(parsePlanMarkdown(download.body).reference).toBe(reference);

    const updated = { ...samplePlan, reference, title: "Updated analytics" };
    const update = await app.inject({ method: "PUT", url: "/plans", headers: { "content-type": "text/markdown" }, payload: formatPlanMarkdown(updated) });
    expect(update.json()).toEqual({ reference });
    expect(repository.get(reference)?.title).toBe("Updated analytics");
  });

  it("returns useful client errors", async () => {
    const repository = new PlanRepository(":memory:");
    const app = createServer({ repository });
    resources.push({ app, repository });
    expect((await app.inject({ method: "GET", url: "/plans/missing" })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: "/plans", headers: { "content-type": "text/markdown" }, payload: "invalid" })).statusCode).toBe(400);
  });
});
