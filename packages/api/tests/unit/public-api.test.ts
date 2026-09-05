import { describe, expect, it } from "vitest";
import * as api from "../../src/index.js";

/**
 * The published surface of `@planner/api` must stay backward compatible across the
 * model refactor: existing exports keep their names, and new exports are additive.
 *
 * This list is the surface as of the commit that introduced the `plans/` feature
 * folder. Removing or renaming an entry is a breaking change and must be a
 * deliberate, reviewed edit to this file.
 */
const requiredExports = [
  "PlanRepository",
  "actionItemSchema",
  "actionItemStatuses",
  "applyPlanPatch",
  "compareItemRefs",
  "componentSchema",
  "componentSections",
  "contentBetween",
  "createServer",
  "decisionSchema",
  "decisionStatuses",
  "diffReferences",
  "emptyReferenceChanges",
  "formatItemsExcerptMarkdown",
  "formatPlanMarkdown",
  "identityProvenance",
  "ingestPlanMarkdown",
  "itemStatuses",
  "knowledgeGapSchema",
  "knowledgeGapStatuses",
  "lineLocation",
  "newActionItemRef",
  "newComponentRef",
  "newItemRef",
  "nodeText",
  "normalizePlan",
  "parseItemHeading",
  "parseLeadingMetadata",
  "parseMarkdownNodes",
  "parsePlanMarkdown",
  "parsePlanPatchMarkdown",
  "planSchema",
  "planStatuses",
  "removePlanComponent",
  "subsectionLabel",
  "textItemSchema",
] as const;

describe("public API surface", () => {
  it("still exports every previously published symbol", () => {
    const actual = new Set(Object.keys(api));
    const missing = requiredExports.filter((name) => !actual.has(name));
    expect(missing).toEqual([]);
  });

  it("exports the plan feature router alongside the generic server factory", () => {
    expect(typeof api.createServer).toBe("function");
    expect(typeof api.registerPlanRoutes).toBe("function");
  });
});
