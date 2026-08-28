import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatPlanMarkdown, parsePlanMarkdown } from "../../../src/plans/markdown.js";
import {
  applyPlanPatch,
  diffReferences,
  identityProvenance,
  parsePlanPatchMarkdown,
  removePlanComponent,
} from "../../../src/plans/patch.js";

const goldenPath = fileURLToPath(new URL("../../fixtures/maximal-plan.md", import.meta.url));
const golden = readFileSync(goldenPath, "utf8");
const reference = "PLAN-00000000-0000-4000-8000-000000000000";
const base = () => parsePlanMarkdown(golden);

const patchDocument = (body: string): string => `---\nreference: ${reference}\n---\n\n${body}\n`;

/**
 * Characterization tests for the partial-document (patch) codec and the merge engine.
 * These pin the behavior that the strict/partial parser unification must preserve.
 */
describe("characterization: partial document parsing", () => {
  it("requires a persisted reference in frontmatter", () => {
    expect(() => parsePlanPatchMarkdown("---\nreference: New\n---\n\n")).toThrow(
      "Plan Markdown error: a partial plan document must carry the persisted plan `reference` in its frontmatter.",
    );
    expect(() => parsePlanPatchMarkdown("# Components\n")).toThrow(
      "Plan Markdown error: a partial plan document must carry the persisted plan `reference` in its frontmatter.",
    );
  });

  it("parses a component patch with metadata, omitting untouched sections", () => {
    const patch = parsePlanPatchMarkdown(patchDocument([
      "## **COMP-1 - Renamed pipeline**",
      "",
      "**Position:** 2",
      "**Replace:** false",
      "",
      "A new description.",
      "",
      "### **Requirements**",
      "",
      "#### Requirement 1.A - Renamed requirement",
      "",
      "New details.",
    ].join("\n")));

    expect(patch.reference).toBe(reference);
    expect(patch.components).toHaveLength(1);
    expect(patch.components[0]).toEqual({
      ref: "COMP-1",
      delete: false,
      replaceChildren: false,
      title: "Renamed pipeline",
      description: "A new description.",
      position: 2,
      items: [{
        kind: "requirements",
        ref: "1.A",
        delete: false,
        value: { title: "Renamed requirement", details: "New details." },
      }],
    });
  });

  it("accepts New placeholders in any case and canonicalizes them", () => {
    const patch = parsePlanPatchMarkdown(patchDocument([
      "## **comp-new - Added component**",
      "",
      "### **Notes**",
      "",
      "#### Note New - Added note",
      "",
      "**Handle:** n1",
      "",
      "Body.",
    ].join("\n")));
    expect(patch.components[0]!.ref).toBe("COMP-New");
    expect(patch.components[0]!.items[0]).toEqual({
      kind: "notes",
      ref: "New",
      delete: false,
      handle: "n1",
      value: { title: "Added note", details: "Body." },
    });
  });

  it("parses knowledge-gap findings and status metadata", () => {
    const patch = parsePlanPatchMarkdown(patchDocument([
      "## **COMP-1 - Ingestion pipeline**",
      "",
      "### **Knowledge Gaps**",
      "",
      "#### Knowledge Gap 1.A - Measured",
      "",
      "**Status:** Resolved",
      "",
      "Body text.",
      "",
      "##### Findings",
      "",
      "Peak is 400 events per second.",
    ].join("\n")));
    expect(patch.components[0]!.items[0]!.value).toEqual({
      title: "Measured",
      details: "Body text.",
      status: "Resolved",
      findings: "Peak is 400 events per second.",
    });
  });

  it("rejects a Status field on item kinds that do not support one", () => {
    expect(() => parsePlanPatchMarkdown(patchDocument([
      "## **COMP-1 - Ingestion pipeline**",
      "",
      "### **Notes**",
      "",
      "#### Note 1.A - Body",
      "",
      "**Status:** Open",
    ].join("\n")))).toThrow("Note 1.A does not support a `Status` metadata field.");
  });

  it("rejects invalid Delete, Position, and Status values", () => {
    const build = (metadata: string): string => patchDocument([
      "## **COMP-1 - Ingestion pipeline**",
      "",
      metadata,
    ].join("\n"));
    expect(() => parsePlanPatchMarkdown(build("**Delete:** maybe"))).toThrow(
      "COMP-1 has an invalid `Delete` value `maybe`. Expected `true` or `false`.",
    );
    expect(() => parsePlanPatchMarkdown(build("**Position:** 1.5"))).toThrow(
      "COMP-1 has an invalid `Position` value `1.5`. Expected a whole number.",
    );
    expect(() => parsePlanPatchMarkdown(build("**Handle:** h\n**Handle:** h2"))).toThrow(
      "COMP-1 contains duplicate metadata field `Handle`.",
    );
    expect(() => parsePlanPatchMarkdown(build("**Status:** Draft"))).toThrow(
      "COMP-1 contains unsupported metadata field `Status`.",
    );
  });

  it("rejects unsupported top-level and subsection headings", () => {
    expect(() => parsePlanPatchMarkdown(patchDocument("## **THING-1 - nope**"))).toThrow(
      "unsupported `## THING-1 - nope` heading. Expected `COMP-<number|New> - <title>` or `ACTION-<number|New> - <title>`.",
    );
    expect(() => parsePlanPatchMarkdown(patchDocument("## **COMP-1 - a**\n\n### **Remarks**"))).toThrow(
      "COMP-1 contains unsupported `### Remarks` subsection.",
    );
    expect(() => parsePlanPatchMarkdown(patchDocument("## **ACTION-1 - a**\n\n### Remarks"))).toThrow(
      "ACTION-1 contains unsupported `### Remarks` subsection.",
    );
  });

  it("parses an action item patch with all three subsections", () => {
    const patch = parsePlanPatchMarkdown(patchDocument([
      "## **ACTION-1 - Validate peak capacity**",
      "",
      "**Status:** Done",
      "",
      "Updated context.",
      "",
      "### Acceptance Criteria",
      "",
      "#### Acceptance Criteria A - Updated",
      "",
      "New body.",
      "",
      "### Trigger Sources",
      "",
      "- COMP-2 - Retrieval surface",
      "",
      "### Assignees",
      "",
      "- Platform team",
    ].join("\n")));
    expect(patch.actionItems[0]).toEqual({
      ref: "ACTION-1",
      delete: false,
      title: "Validate peak capacity",
      status: "Done",
      context: "Updated context.",
      acceptanceCriteria: [{ ref: "A", delete: false, title: "Updated", details: "New body." }],
      triggerSources: [{ ref: "COMP-2", title: "Retrieval surface" }],
      assignees: ["Platform team"],
    });
  });

  it("parses frontmatter metadata overrides", () => {
    const patch = parsePlanPatchMarkdown(
      `---\nreference: ${reference}\ntitle: Renamed\ndescription: New description\ntags:\n  - one\nstatus: done\n---\n`,
    );
    expect(patch.meta).toEqual({
      title: "Renamed",
      description: "New description",
      tags: ["one"],
      status: "Done",
    });
  });
});

describe("characterization: merge engine", () => {
  it("updates an existing item in place without touching siblings", () => {
    const existing = base();
    const { plan } = applyPlanPatch(existing, parsePlanPatchMarkdown(patchDocument([
      "## **COMP-1 - Ingestion pipeline**",
      "",
      "### **Notes**",
      "",
      "#### Note 1.A - Rewritten",
      "",
      "Rewritten body.",
    ].join("\n"))));
    expect(plan.components[0]!.notes).toEqual([{ ref: "1.A", title: "Rewritten", details: "Rewritten body." }]);
    expect(plan.components[0]!.requirements).toEqual(existing.components[0]!.requirements);
  });

  it("upserts an unknown item reference as a new node", () => {
    const { plan } = applyPlanPatch(base(), parsePlanPatchMarkdown(patchDocument([
      "## **COMP-1 - Ingestion pipeline**",
      "",
      "### **Notes**",
      "",
      "#### Note 9.Z - Appended",
      "",
      "Body.",
    ].join("\n"))));
    expect(plan.components[0]!.notes.map((note) => note.ref)).toEqual(["1.A", "1.B"]);
    expect(plan.components[0]!.notes[1]!.title).toBe("Appended");
  });

  it("gives a placeholder-titled new item its canonical label once renumbered", () => {
    const { plan } = applyPlanPatch(base(), parsePlanPatchMarkdown(patchDocument([
      "## **COMP-1 - Ingestion pipeline**",
      "",
      "### **Notes**",
      "",
      "#### Note New",
    ].join("\n"))));
    expect(plan.components[0]!.notes[1]).toEqual({ ref: "1.B", title: "Note 1.B", details: "" });
  });

  it("replaces all children of a component when Replace is true", () => {
    const { plan } = applyPlanPatch(base(), parsePlanPatchMarkdown(patchDocument([
      "## **COMP-1 - Ingestion pipeline**",
      "",
      "**Replace:** true",
      "",
      "### **Requirements**",
      "",
      "#### Requirement 1.C - Kept",
      "",
      "Body.",
    ].join("\n"))));
    expect(plan.components[0]!.requirements).toEqual([{ ref: "1.A", title: "Kept", details: "Body." }]);
    expect(plan.components[0]!.notes).toEqual([]);
  });

  it("deletes a component and renumbers the remainder", () => {
    const { plan } = applyPlanPatch(base(), parsePlanPatchMarkdown(patchDocument([
      "## **COMP-1 - Ingestion pipeline**",
      "",
      "**Delete:** true",
    ].join("\n"))));
    expect(plan.components).toHaveLength(1);
    expect(plan.components[0]!.ref).toBe("COMP-1");
    expect(plan.components[0]!.title).toBe("Retrieval surface");
    expect(plan.components[0]!.requirements[0]!.ref).toBe("1.A");
  });

  it("appends a new action item with the next numeric reference", () => {
    const { plan } = applyPlanPatch(base(), parsePlanPatchMarkdown(patchDocument([
      "## **ACTION-New - Added action**",
      "",
      "**Handle:** a1",
    ].join("\n"))));
    expect(plan.actionItems).toHaveLength(5);
    expect(plan.actionItems[4]).toEqual({
      ref: "ACTION-5",
      title: "Added action",
      status: "TODO",
      context: "",
      acceptanceCriteria: [],
      triggerSources: [],
      assignees: [],
    });
  });

  it("applies explicit positions, clamping out-of-range values", () => {
    const { plan } = applyPlanPatch(base(), parsePlanPatchMarkdown(patchDocument([
      "## **COMP-2 - Retrieval surface**",
      "",
      "**Position:** 99",
      "",
      "## **COMP-1 - Ingestion pipeline**",
      "",
      "**Position:** 1",
    ].join("\n"))));
    expect(plan.components.map((component) => component.title)).toEqual([
      "Ingestion pipeline",
      "Retrieval surface",
    ]);
  });

  it("reorders components when a position moves one ahead of another", () => {
    const { plan } = applyPlanPatch(base(), parsePlanPatchMarkdown(patchDocument([
      "## **COMP-2 - Retrieval surface**",
      "",
      "**Position:** 1",
    ].join("\n"))));
    expect(plan.components.map((component) => component.title)).toEqual([
      "Retrieval surface",
      "Ingestion pipeline",
    ]);
    expect(plan.components.map((component) => component.ref)).toEqual(["COMP-1", "COMP-2"]);
  });
});

describe("characterization: reference diffing", () => {
  it("reports no changes for an identity patch", () => {
    const existing = base();
    const { plan, provenance } = applyPlanPatch(existing, parsePlanPatchMarkdown(patchDocument("")));
    expect(diffReferences(existing, plan, provenance)).toEqual({ shifted: false, changes: [] });
  });

  it("reports additions without marking references shifted", () => {
    const existing = base();
    const { plan, provenance } = applyPlanPatch(existing, parsePlanPatchMarkdown(patchDocument([
      "## **COMP-1 - Ingestion pipeline**",
      "",
      "### **Notes**",
      "",
      "#### Note New - Added",
      "",
      "**Handle:** h1",
    ].join("\n"))));
    const changes = diffReferences(existing, plan, provenance);
    expect(changes.shifted).toBe(false);
    expect(changes.changes).toEqual([
      { change: "added", kind: "notes", to: "1.B", handle: "h1", title: "Added", parent: "COMP-1" },
    ]);
  });

  it("reports renames and removals as shifted", () => {
    const existing = base();
    const { plan, provenance, removed } = removePlanComponent(existing, "COMP-1");
    expect(removed).toBe(true);
    const changes = diffReferences(existing, plan, provenance);
    expect(changes.shifted).toBe(true);
    expect(changes.changes).toContainEqual({ change: "renamed", kind: "component", from: "COMP-2", to: "COMP-1" });
    expect(changes.changes).toContainEqual({ change: "removed", kind: "component", from: "COMP-1" });
  });

  it("reports a missing component as not removed", () => {
    const existing = base();
    const result = removePlanComponent(existing, "COMP-9");
    expect(result.removed).toBe(false);
    expect(result.plan).toBe(existing);
  });

  it("builds identity provenance covering every component item bucket", () => {
    const provenance = identityProvenance(base());
    expect(Object.keys(provenance.components[0]!.items).sort()).toEqual([
      "constraints",
      "decisions",
      "knowledgeGaps",
      "notes",
      "questions",
      "requirements",
    ]);
  });
});

describe("characterization: patched plans stay canonically encodable", () => {
  it("re-encodes a patched plan to a document that parses back identically", () => {
    const { plan } = applyPlanPatch(base(), parsePlanPatchMarkdown(patchDocument([
      "## **COMP-New - Brand new component**",
      "",
      "### **Requirements**",
      "",
      "#### Requirement New - Fresh",
      "",
      "Fresh body.",
    ].join("\n"))));
    const markdown = formatPlanMarkdown(plan);
    expect(parsePlanMarkdown(markdown)).toEqual(plan);
  });
});
