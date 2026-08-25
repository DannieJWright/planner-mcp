import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Component, Plan } from "../../src/domain.js";
import { formatPlanMarkdown } from "../../src/markdown.js";
import { PlanRepository } from "../../src/repository.js";
import { createServer } from "../../src/server.js";

const resources: Array<{ app: FastifyInstance; repository: PlanRepository }> = [];

afterEach(async () => {
  for (const { app, repository } of resources.splice(0)) {
    await app.close();
    repository.close();
  }
});

function component(number: number): Component {
  return {
    ref: `COMP-${number}`,
    title: `Topic ${number}`,
    description: `Description ${number}`,
    requirements: [
      { ref: `${number}.A`, title: `Requirement ${number}.A`, details: "first" },
      { ref: `${number}.B`, title: `Requirement ${number}.B`, details: "second" },
    ],
    constraints: [],
    decisions: [
      { ref: `${number}.A`, title: `Decision ${number}.A`, status: "Open", details: "open decision" },
      { ref: `${number}.B`, title: `Decision ${number}.B`, status: "Decided", details: "settled decision" },
    ],
    knowledgeGaps: [
      { ref: `${number}.A`, title: `Knowledge Gap ${number}.A`, status: "Open", details: "unknown", findings: "" },
      { ref: `${number}.B`, title: `Knowledge Gap ${number}.B`, status: "Resolved", details: "known", findings: "Measured." },
    ],
    notes: [{ ref: `${number}.A`, title: `Note ${number}.A`, details: "note" }],
    questions: [],
  };
}

function seedPlan(): Plan {
  return {
    reference: "New",
    title: "Retrieval fixture",
    description: "A plan",
    tags: [],
    status: "Draft",
    components: [component(1), component(2), component(3)],
    actionItems: [],
  };
}

function setup(): { app: FastifyInstance; repository: PlanRepository; reference: string } {
  const repository = new PlanRepository(":memory:");
  const app = createServer({ repository });
  resources.push({ app, repository });
  const reference = repository.save(seedPlan());
  return { app, repository, reference };
}

const patchHeaders = { "content-type": "text/markdown" };

describe("PATCH /plans/:reference", () => {
  it("merges a partial document without touching omitted nodes", async () => {
    const { app, repository, reference } = setup();
    const response = await app.inject({
      method: "PATCH",
      url: `/plans/${reference}`,
      headers: patchHeaders,
      payload: `---\nreference: ${reference}\n---\n\n## **COMP-2 - Topic 2**\n\n### **Requirements**\n\n#### Requirement 2.B - Replaced title\n\nNew body.\n`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reference, validationFailures: { ordering: [] }, referenceChanges: { shifted: false, changes: [] } });
    const stored = repository.get(reference)!;
    expect(stored.components).toHaveLength(3);
    expect(stored.components[1]!.requirements).toEqual([
      { ref: "2.A", title: "Requirement 2.A", details: "first" },
      { ref: "2.B", title: "Replaced title", details: "New body." },
    ]);
    expect(stored.components[0]).toEqual(seedPlan().components[0]);
  });

  it("upserts new nodes and reports their assigned references", async () => {
    const { app, repository, reference } = setup();
    const response = await app.inject({
      method: "PATCH",
      url: `/plans/${reference}`,
      headers: patchHeaders,
      payload: `---\nreference: ${reference}\n---\n\n## **COMP-New - Audit logging**\n\n**Handle:** audit\n\n### **Requirements**\n\n#### Requirement New - Every mutation writes an audit row\n\n**Handle:** audit-write\n\nBody.\n`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      referenceChanges: {
        shifted: false,
        changes: [
          { change: "added", kind: "component", to: "COMP-4", handle: "audit", title: "Audit logging" },
          { change: "added", kind: "requirements", to: "4.A", handle: "audit-write", title: "Every mutation writes an audit row", parent: "COMP-4" },
        ],
      },
    });
    expect(repository.get(reference)!.components).toHaveLength(4);
  });

  it("reorders components and reports every shifted reference", async () => {
    const { app, repository, reference } = setup();
    const response = await app.inject({
      method: "PATCH",
      url: `/plans/${reference}`,
      headers: patchHeaders,
      payload: `---\nreference: ${reference}\n---\n\n## **COMP-3 - Topic 3**\n\n**Position:** 1\n`,
    });

    const body = response.json<{ referenceChanges: { shifted: boolean; changes: Array<Record<string, string>> } }>();
    expect(body.referenceChanges.shifted).toBe(true);
    expect(body.referenceChanges.changes).toContainEqual({ change: "renamed", kind: "component", from: "COMP-3", to: "COMP-1" });
    expect(body.referenceChanges.changes).toContainEqual({ change: "renamed", kind: "decisions", from: "3.A", to: "1.A" });
    expect(repository.get(reference)!.components.map(({ title }) => title)).toEqual(["Topic 3", "Topic 1", "Topic 2"]);
  });

  it("deletes an item through a delete marker and persists the renumbering", async () => {
    const { app, repository, reference } = setup();
    const response = await app.inject({
      method: "PATCH",
      url: `/plans/${reference}`,
      headers: patchHeaders,
      payload: `---\nreference: ${reference}\n---\n\n## **COMP-1 - Topic 1**\n\n### **Requirements**\n\n#### Requirement 1.A - gone\n\n**Delete:** true\n`,
    });

    expect(response.statusCode).toBe(200);
    expect(repository.get(reference)!.components[0]!.requirements).toEqual([{ ref: "1.A", title: "Requirement 1.A", details: "second" }]);
    expect(response.json<{ referenceChanges: { changes: unknown[] } }>().referenceChanges.changes).toContainEqual({ change: "renamed", kind: "requirements", from: "1.B", to: "1.A" });
  });

  it("replaces a component's children when the replace marker is set", async () => {
    const { app, repository, reference } = setup();
    await app.inject({
      method: "PATCH",
      url: `/plans/${reference}`,
      headers: patchHeaders,
      payload: `---\nreference: ${reference}\n---\n\n## **COMP-2 - Topic 2**\n\n**Replace:** true\n\n### **Requirements**\n\n#### Requirement New - Only survivor\n`,
    });
    const stored = repository.get(reference)!.components[1]!;
    expect(stored.requirements).toEqual([{ ref: "2.A", title: "Only survivor", details: "" }]);
    expect(stored.decisions).toEqual([]);
    expect(stored.knowledgeGaps).toEqual([]);
  });

  it("rejects unknown plans, mismatched references, and malformed documents", async () => {
    const { app, reference } = setup();
    expect((await app.inject({ method: "PATCH", url: "/plans/missing", headers: patchHeaders, payload: `---\nreference: missing\n---\n` })).statusCode).toBe(404);

    const mismatch = await app.inject({ method: "PATCH", url: `/plans/${reference}`, headers: patchHeaders, payload: "---\nreference: PLAN-other\n---\n" });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toEqual({ error: expect.stringContaining("does not match the requested plan") });

    const noReference = await app.inject({ method: "PATCH", url: `/plans/${reference}`, headers: patchHeaders, payload: "## **COMP-1 - Topic 1**\n" });
    expect(noReference.statusCode).toBe(400);
    expect(noReference.json()).toEqual({ error: expect.stringContaining("must carry the persisted plan `reference`") });

    const typo = await app.inject({ method: "PATCH", url: `/plans/${reference}`, headers: patchHeaders, payload: `---\nreference: ${reference}\n---\n\n## **COMP-1 - Topic 1**\n\n**Deleet:** true\n` });
    expect(typo.statusCode).toBe(400);
    expect(typo.json()).toEqual({ error: expect.stringContaining("unsupported metadata field `Deleet`") });
  });
});

describe("DELETE /plans/:reference/components/:componentRef", () => {
  it("removes a component, renumbers the plan, and reports reference changes", async () => {
    const { app, repository, reference } = setup();
    const response = await app.inject({ method: "DELETE", url: `/plans/${reference}/components/COMP-2` });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ reference: string; referenceChanges: { shifted: boolean; changes: Array<Record<string, string>> } }>();
    expect(body.reference).toBe(reference);
    expect(body.referenceChanges.shifted).toBe(true);
    expect(body.referenceChanges.changes).toContainEqual({ change: "renamed", kind: "component", from: "COMP-3", to: "COMP-2" });
    expect(body.referenceChanges.changes).toContainEqual({ change: "removed", kind: "component", from: "COMP-2" });

    const stored = repository.get(reference)!;
    expect(stored.components.map(({ ref }) => ref)).toEqual(["COMP-1", "COMP-2"]);
    expect(stored.components[1]!.title).toBe("Topic 3");
    expect(stored.components[1]!.requirements[0]!.ref).toBe("2.A");
  });

  it("returns explicit not-found errors rather than succeeding as a no-op", async () => {
    const { app, repository, reference } = setup();
    expect((await app.inject({ method: "DELETE", url: "/plans/missing/components/COMP-1" })).json()).toEqual({ error: "Plan not found" });
    const missingComponent = await app.inject({ method: "DELETE", url: `/plans/${reference}/components/COMP-9` });
    expect(missingComponent.statusCode).toBe(404);
    expect(missingComponent.json()).toEqual({ error: "Component not found" });
    expect(repository.get(reference)!.components).toHaveLength(3);
  });
});

describe("GET /plans/:reference/knowledge-gaps and /decisions", () => {
  it("defaults to Open and groups results by component in ascending reference order", async () => {
    const { app, reference } = setup();
    const response = await app.inject({ method: "GET", url: `/plans/${reference}/knowledge-gaps` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      plan: { reference, title: "Retrieval fixture" },
      components: [1, 2, 3].map((number) => ({
        ref: `COMP-${number}`,
        title: `Topic ${number}`,
        items: [{ ref: `${number}.A`, title: `Knowledge Gap ${number}.A`, status: "Open", details: "unknown", findings: "" }],
      })),
    });

    const decisions = await app.inject({ method: "GET", url: `/plans/${reference}/decisions` });
    expect(decisions.json<{ components: Array<{ items: Array<{ ref: string }> }> }>().components.map(({ items }) => items.map(({ ref }) => ref))).toEqual([["1.A"], ["2.A"], ["3.A"]]);
  });

  it("sorts by component number then item letter across multi-letter references", async () => {
    const repository = new PlanRepository(":memory:");
    const app = createServer({ repository });
    resources.push({ app, repository });
    const plan = seedPlan();
    plan.components = [{
      ...component(1),
      decisions: [
        { ref: "1.A.A", title: "Decision 1.A.A", status: "Open", details: "" },
        { ref: "1.B", title: "Decision 1.B", status: "Open", details: "" },
        { ref: "1.A", title: "Decision 1.A", status: "Open", details: "" },
      ],
    }];
    const reference = repository.save(plan);
    const response = await app.inject({ method: "GET", url: `/plans/${reference}/decisions` });
    expect(response.json<{ components: Array<{ items: Array<{ ref: string }> }> }>().components[0]!.items.map(({ ref }) => ref)).toEqual(["1.A", "1.B", "1.A.A"]);
  });

  it("filters by status and supports all", async () => {
    const { app, reference } = setup();
    const resolved = await app.inject({ method: "GET", url: `/plans/${reference}/knowledge-gaps?status=Resolved` });
    expect(resolved.json<{ components: Array<{ items: Array<{ ref: string }> }> }>().components[0]!.items.map(({ ref }) => ref)).toEqual(["1.B"]);

    const all = await app.inject({ method: "GET", url: `/plans/${reference}/decisions?status=all` });
    expect(all.json<{ components: Array<{ items: Array<{ ref: string }> }> }>().components[0]!.items.map(({ ref }) => ref)).toEqual(["1.A", "1.B"]);

    const invalid = await app.inject({ method: "GET", url: `/plans/${reference}/decisions?status=Resolved` });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: expect.stringContaining("Invalid status `Resolved`") });
    expect((await app.inject({ method: "GET", url: `/plans/${reference}/knowledge-gaps?status=Decided` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/plans/${reference}/decisions?format=xml` })).statusCode).toBe(400);
  });

  it("returns an items-only Markdown excerpt rather than a full plan document", async () => {
    const { app, reference } = setup();
    const response = await app.inject({ method: "GET", url: `/plans/${reference}/knowledge-gaps?status=Resolved&format=markdown` });
    expect(response.headers["content-type"]).toContain("text/markdown");
    expect(response.body).toBe(`# ${reference} - Retrieval fixture

## COMP-1 - Topic 1

#### Knowledge Gap 1.B

**Status:** Resolved

known

##### Findings

Measured.

## COMP-2 - Topic 2

#### Knowledge Gap 2.B

**Status:** Resolved

known

##### Findings

Measured.

## COMP-3 - Topic 3

#### Knowledge Gap 3.B

**Status:** Resolved

known

##### Findings

Measured.
`);
    expect(response.body).not.toContain("# Components");
    expect(response.body).not.toContain("### **Requirements**");
  });

  it("returns an empty result for a plan with no matches and 404 for an unknown plan", async () => {
    const repository = new PlanRepository(":memory:");
    const app = createServer({ repository });
    resources.push({ app, repository });
    const reference = repository.save({ ...seedPlan(), components: [] });

    const json = await app.inject({ method: "GET", url: `/plans/${reference}/knowledge-gaps` });
    expect(json.statusCode).toBe(200);
    expect(json.json()).toEqual({ plan: { reference, title: "Retrieval fixture" }, components: [] });

    const markdown = await app.inject({ method: "GET", url: `/plans/${reference}/decisions?format=markdown` });
    expect(markdown.statusCode).toBe(200);
    expect(markdown.body).toBe(`# ${reference} - Retrieval fixture\n`);

    expect((await app.inject({ method: "GET", url: "/plans/missing/knowledge-gaps" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/plans/missing/decisions" })).json()).toEqual({ error: "Plan not found" });
  });
});

describe("PUT /plans reports reference shifts for existing plans", () => {
  it("returns an empty change set when creating a plan", async () => {
    const repository = new PlanRepository(":memory:");
    const app = createServer({ repository });
    resources.push({ app, repository });
    const response = await app.inject({ method: "PUT", url: "/plans", headers: patchHeaders, payload: formatPlanMarkdown(seedPlan()) });
    expect(response.json()).toMatchObject({ referenceChanges: { shifted: false, changes: [] } });
  });

  it("reports references removed by a full re-upload", async () => {
    const { app, reference } = setup();
    const shrunk = { ...seedPlan(), reference, components: [component(1)] };
    const response = await app.inject({ method: "PUT", url: "/plans", headers: patchHeaders, payload: formatPlanMarkdown(shrunk) });
    const body = response.json<{ referenceChanges: { shifted: boolean; changes: Array<Record<string, string>> } }>();
    expect(body.referenceChanges.shifted).toBe(true);
    expect(body.referenceChanges.changes).toContainEqual({ change: "removed", kind: "component", from: "COMP-2" });
    expect(body.referenceChanges.changes).toContainEqual({ change: "removed", kind: "component", from: "COMP-3" });
  });
});
