import { afterEach, describe, expect, it } from "vitest";
import { PlanRepository } from "../../../src/plans/repository.js";
import { samplePlan } from "../../fixtures/sample-plan.js";

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
    expect(repository.get(reference)?.components[0]?.knowledgeGaps[0]?.findings).toEqual(samplePlan.components[0]?.knowledgeGaps[0]?.findings);
    expect(repository.get(reference)?.actionItems).toEqual(samplePlan.actionItems);

    repository.save({ ...samplePlan, reference, title: "Updated", components: [], actionItems: [] });
    expect(repository.get(reference)).toMatchObject({ title: "Updated", components: [], actionItems: [] });
    expect(repository.database.prepare("SELECT COUNT(*) AS count FROM knowledge_gap_findings").get()).toEqual({ count: 0 });
    expect(repository.database.prepare("SELECT COUNT(*) AS count FROM action_acceptance_criteria").get()).toEqual({ count: 0 });
  });

  it("deletes a plan and cascades to its components and items", () => {
    const repository = new PlanRepository(":memory:");
    repositories.push(repository);
    const reference = repository.save(samplePlan);

    expect(repository.delete(reference)).toBe(true);
    expect(repository.get(reference)).toBeUndefined();
    expect(repository.database.prepare("SELECT COUNT(*) AS count FROM components").get()).toEqual({ count: 0 });
    expect(repository.database.prepare("SELECT COUNT(*) AS count FROM items").get()).toEqual({ count: 0 });
    expect(repository.database.prepare("SELECT COUNT(*) AS count FROM action_items").get()).toEqual({ count: 0 });
    expect(repository.delete(reference)).toBe(false);
  });

  it("preserves legacy finding rows as one direct findings body", () => {
    const repository = new PlanRepository(":memory:");
    repositories.push(repository);
    const reference = repository.save(samplePlan);
    const gap = repository.database.prepare("SELECT id FROM items WHERE kind = 'knowledge_gap'").get() as { id: number };
    repository.database.prepare("UPDATE knowledge_gap_findings SET details = ? WHERE knowledge_gap_id = ?").run("First legacy finding.", gap.id);
    repository.database.prepare(`
      INSERT INTO knowledge_gap_findings(knowledge_gap_id, ref, title, details, position)
      VALUES (?, ?, ?, ?, ?)
    `).run(gap.id, "1.A.2", "Finding 1.A.2", "Second legacy finding.", 1);

    expect(repository.get(reference)?.components[0]?.knowledgeGaps[0]?.findings).toBe("First legacy finding.\n\nSecond legacy finding.");
  });
});
