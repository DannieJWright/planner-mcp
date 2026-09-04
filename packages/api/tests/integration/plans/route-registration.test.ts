import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { componentItemSections } from "../../../src/plans/models/component.js";
import { decisionsSection } from "../../../src/plans/models/decision.js";
import { PlanRepository } from "../../../src/plans/repository.js";
import { createServer } from "../../../src/server.js";

/**
 * Pins the route-registration timing documented in docs/MODELS.md: retrieval routes are
 * registered when `createServer` runs. This test adds a status-bearing section to the live
 * registry inside its own process (a testing technique; there is no runtime registration
 * feature) and shows it gets parse/normalize/persistence support immediately but its HTTP
 * route only on the next server construction. Changing that behavior is an explicit decision,
 * not a refactor.
 */
const probeSection = {
  ...decisionsSection,
  key: "routeProbe",
  heading: "Route Probe",
  singularLabel: "Route Probe Entry",
} as unknown as typeof componentItemSections[number];

function register(): void {
  componentItemSections.push(probeSection);
}

function unregister(): void {
  const index = componentItemSections.indexOf(probeSection);
  if (index !== -1) componentItemSections.splice(index, 1);
}

const apps: FastifyInstance[] = [];
let repository: PlanRepository | undefined;

afterEach(async () => {
  unregister();
  for (const app of apps.splice(0)) await app.close();
  repository?.close();
  repository = undefined;
});

describe("retrieval routes are registered at server construction", () => {
  it("exists only on servers constructed after the section is registered", async () => {
    repository = new PlanRepository(":memory:");
    const early = createServer({ repository });
    apps.push(early);
    register();
    const late = createServer({ repository });
    apps.push(late);

    // No route on the earlier server: Fastify's own 404 (message field), not our handler.
    const missing = await early.inject({ method: "GET", url: "/plans/PLAN-x/route-probe" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toHaveProperty("message");

    // Route on the later server: our handler runs and reports the unknown plan.
    const present = await late.inject({ method: "GET", url: "/plans/PLAN-x/route-probe" });
    expect(present.statusCode).toBe(404);
    expect(present.json()).toEqual({ error: "Plan not found" });
  });
});
