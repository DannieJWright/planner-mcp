import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { formatPlanMarkdown, parsePlanMarkdown } from "../../src/markdown.js";
import { PlanRepository } from "../../src/repository.js";

const goldenPath = fileURLToPath(new URL("../fixtures/maximal-plan.md", import.meta.url));
const golden = readFileSync(goldenPath, "utf8");

/**
 * Characterization tests for the persistence boundary. These pin the row mapping,
 * ordering, and schema behavior that the per-model persistence mappers must preserve.
 */
describe("characterization: persistence round trip", () => {
  let repository: PlanRepository;

  beforeEach(() => {
    repository = new PlanRepository(":memory:");
  });

  it("round-trips the maximal plan through SQLite without loss", () => {
    const plan = parsePlanMarkdown(golden);
    const reference = repository.save(plan);
    expect(reference).toBe(plan.reference);
    expect(repository.get(reference)).toEqual(plan);
  });

  it("re-encodes a persisted plan to the identical canonical document", () => {
    const plan = parsePlanMarkdown(golden);
    repository.save(plan);
    expect(formatPlanMarkdown(repository.get(plan.reference)!)).toBe(golden);
  });

  it("mints a PLAN- reference for a New plan and preserves it afterwards", () => {
    const plan = parsePlanMarkdown(golden.replace(/^reference: .*$/m, "reference: New"));
    const reference = repository.save(plan);
    expect(reference).toMatch(/^PLAN-[0-9a-f-]{36}$/);
    expect(repository.get(reference)!.reference).toBe(reference);
  });

  it("replaces all children atomically on a second save", () => {
    const plan = parsePlanMarkdown(golden);
    repository.save(plan);
    const trimmed = structuredClone(plan);
    trimmed.components = [plan.components[0]!];
    trimmed.actionItems = [];
    repository.save(trimmed);
    const stored = repository.get(plan.reference)!;
    expect(stored.components).toHaveLength(1);
    expect(stored.actionItems).toHaveLength(0);
    const counts = repository.database
      .prepare("SELECT (SELECT COUNT(*) FROM components) AS components, (SELECT COUNT(*) FROM action_items) AS actions, (SELECT COUNT(*) FROM knowledge_gap_findings) AS findings")
      .get() as { components: number; actions: number; findings: number };
    expect(counts).toEqual({ components: 1, actions: 0, findings: 3 });
  });

  it("preserves component, item, and action ordering across a reload", () => {
    const plan = parsePlanMarkdown(golden);
    repository.save(plan);
    const stored = repository.get(plan.reference)!;
    expect(stored.components.map((component) => component.ref)).toEqual(["COMP-1", "COMP-2"]);
    expect(stored.components[0]!.decisions.map((decision) => decision.ref)).toEqual(["1.A", "1.B", "1.C"]);
    expect(stored.actionItems.map((action) => action.ref)).toEqual(["ACTION-1", "ACTION-2", "ACTION-3", "ACTION-4"]);
    expect(stored.actionItems[0]!.acceptanceCriteria.map((criterion) => criterion.ref)).toEqual(["A", "B"]);
    expect(stored.actionItems[0]!.assignees).toEqual(["Data team", "Platform team"]);
  });

  it("stores each knowledge gap with a single findings row named Findings", () => {
    const plan = parsePlanMarkdown(golden);
    repository.save(plan);
    const rows = repository.database
      .prepare("SELECT ref, title, details, position FROM knowledge_gap_findings ORDER BY id")
      .all() as unknown as Array<{ ref: string; title: string; details: string; position: number }>;
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.ref === "findings" && row.title === "Findings" && row.position === 0)).toBe(true);
    expect(rows[1]!.details).toContain("The repository owns every direct database access.");
  });

  it("persists the six item kinds under their snake_case names", () => {
    const plan = parsePlanMarkdown(golden);
    repository.save(plan);
    const kinds = repository.database
      .prepare("SELECT DISTINCT kind FROM items ORDER BY kind")
      .all() as unknown as Array<{ kind: string }>;
    expect(kinds.map((row) => row.kind)).toEqual([
      "constraint",
      "decision",
      "knowledge_gap",
      "note",
      "question",
      "requirement",
    ]);
  });

  it("stores a status only for decisions and knowledge gaps", () => {
    const plan = parsePlanMarkdown(golden);
    repository.save(plan);
    const rows = repository.database
      .prepare("SELECT DISTINCT kind FROM items WHERE status IS NOT NULL ORDER BY kind")
      .all() as unknown as Array<{ kind: string }>;
    expect(rows.map((row) => row.kind)).toEqual(["decision", "knowledge_gap"]);
  });

  it("migrates the legacy finding item kind to note when the database is reopened", () => {
    const directory = mkdtempSync(join(tmpdir(), "planner-characterization-"));
    const file = join(directory, "planner.sqlite");
    const plan = parsePlanMarkdown(golden);
    const first = new PlanRepository(file);
    first.save(plan);
    first.database.exec("UPDATE items SET kind = 'finding' WHERE kind = 'note'");
    expect(() => first.get(plan.reference)).toThrow("Unknown item kind in database: finding");
    first.close();

    const reopened = new PlanRepository(file);
    expect(reopened.get(plan.reference)!.components[0]!.notes).toEqual([
      { ref: "1.A", title: "Note 1.A", details: "The current export is CSV and Finance reviews reports monthly." },
    ]);
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("throws when the database holds an unknown item kind", () => {
    const plan = parsePlanMarkdown(golden);
    repository.save(plan);
    repository.database.exec("UPDATE items SET kind = 'mystery' WHERE kind = 'note'");
    expect(() => repository.get(plan.reference)).toThrow("Unknown item kind in database: mystery");
  });

  it("lists plans as summaries without components or action items", () => {
    const plan = parsePlanMarkdown(golden);
    repository.save(plan);
    expect(repository.list()).toEqual([{
      reference: plan.reference,
      title: plan.title,
      description: plan.description,
      tags: plan.tags,
      status: plan.status,
    }]);
  });

  it("cascades deletion to every child table", () => {
    const plan = parsePlanMarkdown(golden);
    repository.save(plan);
    expect(repository.delete(plan.reference)).toBe(true);
    expect(repository.delete(plan.reference)).toBe(false);
    const remaining = repository.database
      .prepare("SELECT (SELECT COUNT(*) FROM components) AS c, (SELECT COUNT(*) FROM items) AS i, (SELECT COUNT(*) FROM action_items) AS a, (SELECT COUNT(*) FROM action_assignees) AS s")
      .get() as { c: number; i: number; a: number; s: number };
    expect(remaining).toEqual({ c: 0, i: 0, a: 0, s: 0 });
  });

  it("returns undefined for a missing plan", () => {
    expect(repository.get("PLAN-missing")).toBeUndefined();
  });
});
