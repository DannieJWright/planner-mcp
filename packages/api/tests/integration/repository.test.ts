import { afterEach, describe, expect, it } from "vitest";
import { PlanRepository } from "../../src/repository.js";
import { samplePlan } from "../fixtures/sample-plan.js";

const repositories: PlanRepository[] = [];

afterEach(() => repositories.splice(0).forEach((repository) => repository.close()));

describe("PlanRepository", () => {
  it("creates and atomically replaces a plan hierarchy", () => {
    const repository = new PlanRepository(":memory:");
    repositories.push(repository);
    const reference = repository.save(samplePlan);
    expect(reference).toMatch(/^PLAN-/);
    expect(repository.list()[0]?.title).toBe(samplePlan.title);
    expect(repository.get(reference)?.components[0]?.requirements).toHaveLength(1);

    repository.save({ ...samplePlan, reference, title: "Updated", components: [] });
    expect(repository.get(reference)).toMatchObject({ title: "Updated", components: [] });
  });
});
