import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actionItemSchema, actionItemSections } from "../../../src/plans/models/actionItem.js";
import { formatPlanMarkdown, ingestPlanMarkdown, parsePlanMarkdown } from "../../../src/plans/markdown.js";
import { textSection } from "../../../src/plans/models/textItem.js";
import { z } from "zod";

/**
 * Reference normalization must not be restricted to component sections. A heading-item
 * section registered under an action item with the renumber role is renumbered by
 * position and rewritten in prose exactly like a component section, instead of being
 * silently skipped because it does not belong to `componentItemSections`.
 */
const milestonesSection = textSection({
  key: "milestones",
  heading: "Milestones",
  singularLabel: "Milestone",
  aliases: ["milestones?", "ms"],
  dbKind: null,
});

function register(): void {
  actionItemSections.push(milestonesSection as unknown as typeof actionItemSections[number]);
  (actionItemSchema.shape as Record<string, unknown>).milestones = z.array(
    z.object({ ref: z.string().min(1), title: z.string().min(1), details: z.string() }),
  );
}

function unregister(): void {
  const index = actionItemSections.indexOf(milestonesSection as unknown as typeof actionItemSections[number]);
  if (index !== -1) actionItemSections.splice(index, 1);
  delete (actionItemSchema.shape as Record<string, unknown>).milestones;
}

const document = [
  "---",
  "reference: PLAN-action-sections",
  "title: Action section probe",
  "description: ''",
  "tags: []",
  "status: Draft",
  "---",
  "",
  "# Components",
  "",
  "| Ref | Short Description |",
  "|---|---|",
  "| COMP-1 | Only component |",
  "",
  "## **COMP-1 - Only component**",
  "",
  "Description.",
  "",
  "### **Requirements**",
  "",
  "#### Requirement 9.A - Keep exports",
  "",
  "Exports must survive the probe.",
  "",
  "### **Constraints**",
  "",
  "### **Decisions**",
  "",
  "### **Knowledge Gaps**",
  "",
  "### **Notes**",
  "",
  "### **Open Questions**",
  "",
  "# Action Items",
  "",
  "## **ACTION-1 - Ship the milestone plan**",
  "",
  "**Status:** TODO",
  "",
  "Track progress through milestones, not dates. See ms 9.R for the rollout gate and",
  "ms 7.X for a ref that does not exist.",
  "",
  "### Acceptance Criteria",
  "",
  "#### Acceptance Criteria C - Documented criterion",
  "",
  "The documented criterion holds.",
  "",
  "### Trigger Sources",
  "",
  "- COMP-1 - Only component",
  "",
  "### Assignees",
  "",
  "- Platform team",
  "",
  "### **Milestones**",
  "",
  "#### Milestone 9.Q - Design review",
  "",
  "Design review happens first even though it is written second.",
  "",
  "#### Milestone 9.R - Rollout gate",
  "",
  "Rollout follows the design review.",
].join("\n");

describe("reference normalization for action-item sections", () => {
  beforeEach(register);
  afterEach(unregister);

  it("renumbers a renumber-role section registered under an action item by position", () => {
    const plan = parsePlanMarkdown(document);
    const record = plan.actionItems[0]! as unknown as Record<string, Array<{ ref: string }>>;
    expect(record.milestones!.map((item) => item.ref)).toEqual(["A", "B"]);

    // The component collection is renumbered by the same pass and keeps its scheme.
    expect(plan.components[0]!.requirements.map((item) => item.ref)).toEqual(["1.A"]);
  });

  it("rewrites prose references to the new section through its aliases", () => {
    const plan = parsePlanMarkdown(document);
    expect(plan.actionItems[0]!.context).toContain("See ms B for the rollout gate");
  });

  it("reports unresolved alias references in an action context", () => {
    const result = ingestPlanMarkdown(document);
    expect(result.validationFailures.ordering).toContainEqual({ section: "ACTION-1", failure: "ms 7.X" });
  });

  it("leaves suppress-role sections under the same node untouched", () => {
    const plan = parsePlanMarkdown(document);
    expect(plan.actionItems[0]!.acceptanceCriteria.map((item) => item.ref)).toEqual(["C"]);
  });

  it("formats and round-trips a renumbered action-item section", () => {
    const plan = parsePlanMarkdown(document);
    const markdown = formatPlanMarkdown(plan);
    expect(markdown).toContain("#### Milestone A - Design review");
    expect(parsePlanMarkdown(markdown)).toEqual(plan);
  });
});
