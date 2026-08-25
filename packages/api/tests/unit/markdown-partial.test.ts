import { describe, expect, it } from "vitest";
import { formatPlanMarkdown, ingestPlanMarkdown, parseLeadingMetadata } from "../../src/markdown.js";
import { parsePlanPatchMarkdown } from "../../src/patch.js";
import { samplePlan } from "../fixtures/sample-plan.js";

const frontmatter = "---\nreference: PLAN-abc\n---\n\n";

describe("partial plan document parsing", () => {
  it("requires a persisted plan reference in frontmatter", () => {
    expect(() => parsePlanPatchMarkdown("---\ntitle: X\n---\n")).toThrow("must carry the persisted plan `reference`");
    expect(() => parsePlanPatchMarkdown("---\nreference: New\n---\n")).toThrow("must carry the persisted plan `reference`");
  });

  it("omits root headings and component subsections", () => {
    const patch = parsePlanPatchMarkdown(`${frontmatter}## **COMP-2 - Remove component**

### **Requirements**

#### Requirement 2.C - Component removal updates the database records

Component removal updates the database records within a single transaction.
`);
    expect(patch.reference).toBe("PLAN-abc");
    expect(patch.components).toHaveLength(1);
    const component = patch.components[0]!;
    expect(component).toMatchObject({ ref: "COMP-2", title: "Remove component", delete: false, replaceChildren: false });
    expect(component.description).toBeUndefined();
    expect(component.items).toEqual([{
      kind: "requirements",
      ref: "2.C",
      delete: false,
      value: { title: "Component removal updates the database records", details: "Component removal updates the database records within a single transaction." },
    }]);
  });

  it("accepts New placeholder references with correlation handles", () => {
    const patch = parsePlanPatchMarkdown(`${frontmatter}## **COMP-New - Audit logging for plan mutations**

**Handle:** audit

Record who changed a plan and when.

### **Requirements**

#### Requirement New - Every mutation writes an audit row

**Handle:** audit-write

Each successful write records actor, timestamp, and plan reference.
`);
    const component = patch.components[0]!;
    expect(component).toMatchObject({ ref: "COMP-New", handle: "audit", description: "Record who changed a plan and when." });
    expect(component.items[0]).toMatchObject({ ref: "New", handle: "audit-write" });
  });

  it("parses Delete, Replace, and Position metadata fields", () => {
    const patch = parsePlanPatchMarkdown(`${frontmatter}## **COMP-3 - Retrieval**

**Replace:** true
**Position:** 1

### **Notes**

#### Note 3.B - obsolete

**Delete:** true
`);
    expect(patch.components[0]).toMatchObject({ replaceChildren: true, position: 1 });
    expect(patch.components[0]!.items[0]).toMatchObject({ kind: "notes", ref: "3.B", delete: true });
  });

  it("parses knowledge gap status and findings and rejects status on kinds without one", () => {
    const patch = parsePlanPatchMarkdown(`${frontmatter}## **COMP-1 - One**

### **Knowledge Gaps**

#### Knowledge Gap 1.A - Peak volume

**Status:** Resolved

Measure peak event volume.

##### Findings

Peak volume is 400 events per second.
`);
    expect(patch.components[0]!.items[0]!.value).toEqual({
      title: "Peak volume",
      details: "Measure peak event volume.",
      status: "Resolved",
      findings: "Peak volume is 400 events per second.",
    });

    expect(() => parsePlanPatchMarkdown(`${frontmatter}## **COMP-1 - One**

### **Notes**

#### Note 1.A - x

**Status:** Open
`)).toThrow("does not support a `Status` metadata field");
  });

  it("rejects unknown metadata keys so typos fail loudly", () => {
    expect(() => parsePlanPatchMarkdown(`${frontmatter}## **COMP-1 - One**

**Deleet:** true
`)).toThrow("unsupported metadata field `Deleet`");
  });

  it("rejects unsupported subsections and unsupported top-level headings", () => {
    expect(() => parsePlanPatchMarkdown(`${frontmatter}## **COMP-1 - One**

### **Nonsense**
`)).toThrow("unsupported `### Nonsense` subsection");
    expect(() => parsePlanPatchMarkdown(`${frontmatter}## Something else\n`)).toThrow("unsupported `## Something else` heading");
  });

  it("reads frontmatter metadata and action item patches", () => {
    const patch = parsePlanPatchMarkdown(`---
reference: PLAN-abc
title: Renamed
tags:
  - a
status: In Progress
---

# Action Items

## **ACTION-1 - Validate peak capacity**

**Status:** Done
**Position:** 1

Revalidated.

### Assignees

- Data team
`);
    expect(patch.meta).toEqual({ title: "Renamed", tags: ["a"], status: "In Progress" });
    expect(patch.components).toHaveLength(0);
    expect(patch.actionItems[0]).toMatchObject({ ref: "ACTION-1", status: "Done", position: 1, context: "Revalidated.", assignees: ["Data team"] });
  });
});

describe("parseLeadingMetadata", () => {
  it("stops at the first non-metadata line and returns the remaining prose", () => {
    const result = parseLeadingMetadata("**Status:** Open\n\n**Delete:** true\n\nBody text.\n\n**Status:** Ignored", ["Status", "Delete"], "Note 1.A");
    expect(result.fields).toEqual({ Status: "Open", Delete: "true" });
    expect(result.rest).toBe("Body text.\n\n**Status:** Ignored");
  });

  it("rejects duplicate fields", () => {
    expect(() => parseLeadingMetadata("**Delete:** true\n**Delete:** false", ["Delete"], "Note 1.A")).toThrow("duplicate metadata field");
  });
});

describe("strict ingest is unchanged by partial-mode support", () => {
  it("still rejects a component missing required subsections", () => {
    const markdown = formatPlanMarkdown(samplePlan).replace("### **Notes**\n\n", "");
    expect(() => ingestPlanMarkdown(markdown)).toThrow("is missing required `### Notes` subsection");
  });

  it("still requires both root headings", () => {
    expect(() => ingestPlanMarkdown(formatPlanMarkdown(samplePlan).replace("# Action Items", "## Action Items"))).toThrow("missing required `# Action Items` heading");
  });

  it("round-trips a full document unchanged", () => {
    const markdown = formatPlanMarkdown({ ...samplePlan, reference: "PLAN-abc" });
    expect(formatPlanMarkdown(ingestPlanMarkdown(markdown).plan)).toBe(markdown);
  });
});
