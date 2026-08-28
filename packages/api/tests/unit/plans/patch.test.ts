import { describe, expect, it } from "vitest";
import type { Component, Plan } from "../../../src/plans/domain.js";
import { applyPlanPatch, diffReferences, parsePlanPatchMarkdown, removePlanComponent, type ReferenceChanges } from "../../../src/plans/patch.js";

const frontmatter = "---\nreference: PLAN-abc\n---\n\n";

function component(number: number): Topic {
  return {
    ref: `COMP-${number}`,
    title: `Topic ${number}`,
    description: `Description ${number}`,
    requirements: [
      { ref: `${number}.A`, title: `Requirement ${number}.A`, details: "first" },
      { ref: `${number}.B`, title: `Requirement ${number}.B`, details: "second" },
    ],
    constraints: [],
    decisions: [{ ref: `${number}.A`, title: `Decision ${number}.A`, status: "Open", details: "decide" }],
    knowledgeGaps: [],
    notes: [
      { ref: `${number}.A`, title: `Note ${number}.A`, details: "note one" },
      { ref: `${number}.B`, title: `Note ${number}.B`, details: "note two" },
      { ref: `${number}.C`, title: `Note ${number}.C`, details: "note three" },
    ],
    questions: [],
  };
}

function basePlan(): Plan {
  return {
    reference: "PLAN-abc",
    title: "Base plan",
    description: "A plan",
    tags: [],
    status: "Draft",
    components: [component(1), component(2), component(3), component(4)],
    actionItems: [],
  };
}

function run(markdown: string, original: Plan = basePlan()): { plan: Plan; changes: ReferenceChanges } {
  const result = applyPlanPatch(original, parsePlanPatchMarkdown(markdown));
  return { plan: result.plan, changes: diffReferences(original, result.plan, result.provenance) };
}

describe("applyPlanPatch merge semantics", () => {
  it("updates a matched item and leaves every omitted node untouched (Requirement 1.F)", () => {
    const original = basePlan();
    const { plan, changes } = run(`${frontmatter}## **COMP-2 - Topic 2**

### **Requirements**

#### Requirement 2.B - Renamed requirement

Replaced body.
`, original);

    expect(plan.components[1]!.requirements).toEqual([
      { ref: "2.A", title: "Requirement 2.A", details: "first" },
      { ref: "2.B", title: "Renamed requirement", details: "Replaced body." },
    ]);
    expect(plan.components).toHaveLength(4);
    expect(plan.components[0]).toEqual(original.components[0]);
    expect(plan.components[3]).toEqual(original.components[3]);
    expect(changes).toEqual({ shifted: false, changes: [] });
  });

  it("leaves a node untouched when the partial document supplies only metadata", () => {
    const { plan } = run(`${frontmatter}## **COMP-1 - Topic 1**

**Position:** 1
`);
    expect(plan.components[0]!.description).toBe("Description 1");
  });

  it("upserts an unknown target reference instead of failing (Requirement 1.E)", () => {
    const { plan, changes } = run(`${frontmatter}## **COMP-2 - Topic 2**

### **Requirements**

#### Requirement 2.Z - Brand new

Body.
`);
    expect(plan.components[1]!.requirements.map(({ ref }) => ref)).toEqual(["2.A", "2.B", "2.C"]);
    expect(plan.components[1]!.requirements[2]).toMatchObject({ ref: "2.C", title: "Brand new" });
    expect(changes.shifted).toBe(false);
    expect(changes.changes).toEqual([{ change: "added", kind: "requirements", to: "2.C", title: "Brand new", parent: "COMP-2" }]);
  });

  it("appends new components and items and reports their assigned references (Requirement 1.L)", () => {
    const { plan, changes } = run(`${frontmatter}## **COMP-New - Audit logging for plan mutations**

**Handle:** audit

Record who changed a plan and when.

### **Requirements**

#### Requirement New - Every mutation writes an audit row

**Handle:** audit-write

Each successful write records actor, timestamp, and plan reference.
`);
    expect(plan.components).toHaveLength(5);
    expect(plan.components[4]).toMatchObject({ ref: "COMP-5", title: "Audit logging for plan mutations" });
    expect(changes).toEqual({
      shifted: false,
      changes: [
        { change: "added", kind: "component", to: "COMP-5", handle: "audit", title: "Audit logging for plan mutations" },
        { change: "added", kind: "requirements", to: "5.A", handle: "audit-write", title: "Every mutation writes an audit row", parent: "COMP-5" },
      ],
    });
  });

  it("correlates an added node by title and parent when no handle is supplied", () => {
    const { changes } = run(`${frontmatter}## **COMP-3 - Topic 3**

### **Notes**

#### Note New - Untitled handle
`);
    expect(changes.changes).toEqual([{ change: "added", kind: "notes", to: "3.D", title: "Untitled handle", parent: "COMP-3" }]);
  });

  it("gives a placeholder-titled new node its canonical label after renumbering", () => {
    const { plan } = run(`${frontmatter}## **COMP-3 - Topic 3**

### **Notes**

#### Note New
`);
    expect(plan.components[2]!.notes[3]).toEqual({ ref: "3.D", title: "Note 3.D", details: "" });
  });

  it("creates decisions and knowledge gaps with sane defaults", () => {
    const { plan } = run(`${frontmatter}## **COMP-1 - Topic 1**

### **Knowledge Gaps**

#### Knowledge Gap New - Measure volume

How many events per second?
`);
    expect(plan.components[0]!.knowledgeGaps).toEqual([
      { ref: "1.A", title: "Measure volume", details: "How many events per second?", status: "Open", findings: "" },
    ]);
  });
});

describe("applyPlanPatch delete and replace markers", () => {
  it("deletes an item and reports the resulting renames (Requirement 1.G)", () => {
    const { plan, changes } = run(`${frontmatter}## **COMP-1 - Topic 1**

### **Notes**

#### Note 1.B - obsolete

**Delete:** true
`);
    expect(plan.components[0]!.notes.map(({ ref }) => ref)).toEqual(["1.A", "1.B"]);
    expect(plan.components[0]!.notes[1]!.details).toBe("note three");
    expect(changes.shifted).toBe(true);
    expect(changes.changes).toEqual([
      { change: "renamed", kind: "notes", from: "1.C", to: "1.B" },
      { change: "removed", kind: "notes", from: "1.B" },
    ]);
  });

  it("deletes a whole component and renumbers the components that follow", () => {
    const { plan, changes } = run(`${frontmatter}## **COMP-2 - Topic 2**

**Delete:** true
`);
    expect(plan.components.map(({ ref }) => ref)).toEqual(["COMP-1", "COMP-2", "COMP-3"]);
    expect(plan.components[1]!.title).toBe("Topic 3");
    expect(changes.changes).toContainEqual({ change: "renamed", kind: "component", from: "COMP-3", to: "COMP-2" });
    expect(changes.changes).toContainEqual({ change: "removed", kind: "component", from: "COMP-2" });
    expect(changes.changes).toContainEqual({ change: "removed", kind: "requirements", from: "2.A" });
    expect(changes.shifted).toBe(true);
  });

  it("ignores a delete marker on a node that does not exist", () => {
    const { plan, changes } = run(`${frontmatter}## **COMP-9 - Missing**

**Delete:** true
`);
    expect(plan.components).toHaveLength(4);
    expect(changes).toEqual({ shifted: false, changes: [] });
  });

  it("replaces a component's children wholesale only when Replace is set (Requirement 1.H)", () => {
    const { plan, changes } = run(`${frontmatter}## **COMP-2 - Topic 2**

**Replace:** true

### **Requirements**

#### Requirement New - Retrieve open knowledge gaps for a plan

Provide a tool and endpoint returning open knowledge gaps for one plan.
`);
    const target = plan.components[1]!;
    expect(target.requirements).toEqual([{ ref: "2.A", title: "Retrieve open knowledge gaps for a plan", details: "Provide a tool and endpoint returning open knowledge gaps for one plan." }]);
    expect(target.notes).toEqual([]);
    expect(target.decisions).toEqual([]);
    expect(changes.shifted).toBe(true);
    expect(changes.changes).toContainEqual({ change: "removed", kind: "notes", from: "2.C" });
    expect(changes.changes).toContainEqual({ change: "added", kind: "requirements", to: "2.A", title: "Retrieve open knowledge gaps for a plan", parent: "COMP-2" });
  });

  it("keeps provenance for matched references inside a replaced component", () => {
    const { plan, changes } = run(`${frontmatter}## **COMP-2 - Topic 2**

**Replace:** true

### **Notes**

#### Note 2.C - kept
`);
    expect(plan.components[1]!.notes).toEqual([{ ref: "2.A", title: "kept", details: "note three" }]);
    expect(changes.changes).toContainEqual({ change: "renamed", kind: "notes", from: "2.C", to: "2.A" });
  });
});

describe("applyPlanPatch reordering (Requirement 1.J, Decision 1.F)", () => {
  it("moves a component to a requested position and renumbers everything below it", () => {
    const { plan, changes } = run(`${frontmatter}## **COMP-4 - Topic 4**

**Position:** 1
`);
    expect(plan.components.map(({ title }) => title)).toEqual(["Topic 4", "Topic 1", "Topic 2", "Topic 3"]);
    expect(plan.components.map(({ ref }) => ref)).toEqual(["COMP-1", "COMP-2", "COMP-3", "COMP-4"]);
    expect(changes.shifted).toBe(true);
    expect(changes.changes).toContainEqual({ change: "renamed", kind: "component", from: "COMP-4", to: "COMP-1" });
    expect(changes.changes).toContainEqual({ change: "renamed", kind: "component", from: "COMP-1", to: "COMP-2" });
    expect(changes.changes).toContainEqual({ change: "renamed", kind: "requirements", from: "4.A", to: "1.A" });
    expect(changes.changes).toContainEqual({ change: "renamed", kind: "requirements", from: "1.A", to: "2.A" });
    expect(changes.changes.some((change) => change.change === "removed")).toBe(false);
  });

  it("clamps out-of-range positions instead of erroring", () => {
    expect(run(`${frontmatter}## **COMP-3 - Topic 3**\n\n**Position:** 0\n`).plan.components[0]!.title).toBe("Topic 3");
    expect(run(`${frontmatter}## **COMP-3 - Topic 3**\n\n**Position:** -5\n`).plan.components[0]!.title).toBe("Topic 3");
    expect(run(`${frontmatter}## **COMP-1 - Topic 1**\n\n**Position:** 99\n`).plan.components[3]!.title).toBe("Topic 1");
  });

  it("resolves duplicate positions by the order supplied in the patch document", () => {
    const { plan } = run(`${frontmatter}## **COMP-4 - Topic 4**

**Position:** 1

## **COMP-3 - Topic 3**

**Position:** 1
`);
    expect(plan.components.map(({ title }) => title)).toEqual(["Topic 4", "Topic 3", "Topic 1", "Topic 2"]);
  });

  it("applies positions in ascending order regardless of document order", () => {
    const { plan } = run(`${frontmatter}## **COMP-1 - Topic 1**

**Position:** 4

## **COMP-4 - Topic 4**

**Position:** 2
`);
    expect(plan.components.map(({ title }) => title)).toEqual(["Topic 2", "Topic 4", "Topic 3", "Topic 1"]);
  });

  it("ignores a position on a component that is also being deleted", () => {
    const { plan } = run(`${frontmatter}## **COMP-2 - Topic 2**

**Delete:** true
**Position:** 1
`);
    expect(plan.components.map(({ title }) => title)).toEqual(["Topic 1", "Topic 3", "Topic 4"]);
  });

  it("combines reordering with adds, updates, and deletes in one patch", () => {
    const { plan, changes } = run(`${frontmatter}## **COMP-4 - Topic 4**

**Position:** 1

## **COMP-2 - Topic 2**

**Delete:** true

## **COMP-New - Fresh**

**Handle:** fresh

### **Requirements**

#### Requirement New - Fresh requirement
`);
    expect(plan.components.map(({ title }) => title)).toEqual(["Topic 4", "Topic 1", "Topic 3", "Fresh"]);
    expect(plan.components.map(({ ref }) => ref)).toEqual(["COMP-1", "COMP-2", "COMP-3", "COMP-4"]);
    expect(changes.changes).toContainEqual({ change: "renamed", kind: "component", from: "COMP-4", to: "COMP-1" });
    expect(changes.changes).toContainEqual({ change: "removed", kind: "component", from: "COMP-2" });
    expect(changes.changes).toContainEqual({ change: "added", kind: "component", to: "COMP-4", handle: "fresh", title: "Fresh" });
  });
});

describe("applyPlanPatch normalization integration (Requirement 1.I)", () => {
  it("rewrites cross-references in prose after renumbering", () => {
    const original = basePlan();
    original.components[0]!.notes[0]!.details = "See COMP-4 and requirement 4.A.";
    const { plan, changes } = run(`${frontmatter}## **COMP-4 - Topic 4**

**Position:** 1
`, original);
    expect(plan.components[1]!.notes[0]!.details).toBe("See COMP-1 and requirement 1.A.");
    expect(changes.shifted).toBe(true);
  });

  it("reports unresolvable references through validationFailures", () => {
    const original = basePlan();
    original.components[0]!.notes[0]!.details = "See potato 8.Z.";
    const result = applyPlanPatch(original, parsePlanPatchMarkdown(`${frontmatter}## **COMP-1 - Topic 1**\n`));
    expect(result.validationFailures.ordering).toEqual([{ section: "Note 1.A", failure: "potato 8.Z" }]);
  });

  it("assigns references strictly by array index so provenance stays aligned", () => {
    const original = basePlan();
    const result = applyPlanPatch(original, parsePlanPatchMarkdown(`${frontmatter}## **COMP-4 - Topic 4**\n\n**Position:** 2\n`));
    result.plan.components.forEach((entry, index) => expect(entry.ref).toBe(`COMP-${index + 1}`));
    expect(result.provenance.components).toHaveLength(result.plan.components.length);
    expect(result.provenance.components.map(({ originRef }) => originRef)).toEqual(["COMP-1", "COMP-4", "COMP-2", "COMP-3"]);
    result.plan.components.forEach((entry, index) => {
      expect(result.provenance.components[index]!.items.requirements).toHaveLength(entry.requirements.length);
    });
  });

  it("produces an empty change set for a no-op patch", () => {
    expect(run(`${frontmatter}`)).toMatchObject({ changes: { shifted: false, changes: [] } });
  });

  it("merges frontmatter metadata that is present", () => {
    const { plan } = run(`---\nreference: PLAN-abc\ntitle: Renamed plan\nstatus: In Progress\n---\n`);
    expect(plan).toMatchObject({ title: "Renamed plan", status: "In Progress", description: "A plan" });
  });
});

describe("removePlanComponent", () => {
  it("removes, renumbers, and reports the same shape as a patch (Requirement 2.F)", () => {
    const original = basePlan();
    const result = removePlanComponent(original, "COMP-2");
    expect(result.removed).toBe(true);
    expect(result.plan.components.map(({ ref }) => ref)).toEqual(["COMP-1", "COMP-2", "COMP-3"]);
    const changes = diffReferences(original, result.plan, result.provenance);
    expect(changes.shifted).toBe(true);
    expect(changes.changes).toContainEqual({ change: "renamed", kind: "component", from: "COMP-3", to: "COMP-2" });
    expect(changes.changes).toContainEqual({ change: "renamed", kind: "notes", from: "3.C", to: "2.C" });
    expect(changes.changes).toContainEqual({ change: "removed", kind: "component", from: "COMP-2" });
  });

  it("reports a missing component without mutating the plan", () => {
    const original = basePlan();
    const result = removePlanComponent(original, "COMP-9");
    expect(result.removed).toBe(false);
    expect(result.plan.components).toHaveLength(4);
  });
});
