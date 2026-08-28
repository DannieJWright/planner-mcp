import { describe, expect, it } from "vitest";
import { actionItemSchema, actionItemDescriptor } from "../../../src/plans/models/actionItem.js";
import { componentSchema, componentDescriptor } from "../../../src/plans/models/component.js";
import { isBulletList, isHeadingItems } from "../../../src/plans/models/descriptor.js";
import { planSchema } from "../../../src/plans/models/plan.js";
import {
  allHeadingItemSections,
  allProseSections,
  allSections,
  componentItemSections,
  componentSectionByHeading,
  componentSectionByKey,
  itemLabels,
  nodeDescriptors,
  persistedItemSections,
  sectionByDbKind,
} from "../../../src/plans/models/registry.js";
import { canonicalRefPattern, refHeadingPattern, refHeadingPrefix } from "../../../src/plans/shared/refs.js";

/**
 * The descriptor registry is the single source of truth for plan vocabulary. These
 * tests enforce the invariants that make that safe: descriptors agree with the Zod
 * schemas, names are unique, and every derived matcher stays consistent with the
 * canonical reference pattern.
 */
describe("model registry consistency", () => {
  it("declares a section for every component item field in the schema", () => {
    const schemaKeys = Object.keys(componentSchema.shape).filter((key) => !["ref", "title", "description"].includes(key));
    expect(componentItemSections.map((section) => section.key).sort()).toEqual(schemaKeys.sort());
  });

  it("declares a section for every action item collection in the schema", () => {
    const schemaKeys = Object.keys(actionItemSchema.shape).filter((key) => !["ref", "title", "status", "context"].includes(key));
    expect(actionItemDescriptor.sections.map((section) => section.key).sort()).toEqual(schemaKeys.sort());
  });

  it("declares a collection for every plan node descriptor", () => {
    const schemaKeys = Object.keys(planSchema.shape);
    expect(schemaKeys).toContain("components");
    expect(schemaKeys).toContain("actionItems");
  });

  it("keeps section headings unique within each node", () => {
    for (const node of nodeDescriptors) {
      const headings = node.sections.map((section) => section.heading);
      expect(new Set(headings).size).toBe(headings.length);
    }
  });

  it("keeps model keys unique across every section", () => {
    const keys = allSections().map((section) => section.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps singular item labels unique", () => {
    const labels = allHeadingItemSections().map((section) => section.singularLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("keeps persistence kinds unique and resolvable in both directions", () => {
    const kinds = persistedItemSections().map((section) => section.dbKind!);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const section of persistedItemSections()) {
      expect(sectionByDbKind(section.dbKind!)).toBe(section);
    }
  });

  it("resolves every component section by heading and by key", () => {
    for (const section of componentItemSections) {
      expect(componentSectionByHeading(section.heading)).toBe(section);
      expect(componentSectionByKey(section.key)).toBe(section);
    }
  });

  it("gives every status-bearing section a non-empty status list", () => {
    for (const section of allHeadingItemSections()) {
      if (section.statuses === null) continue;
      expect(section.statuses.length).toBeGreaterThan(0);
      expect(new Set(section.statuses).size).toBe(section.statuses.length);
    }
  });

  it("only renumbers references for component item sections", () => {
    for (const section of allHeadingItemSections()) {
      if (section.referenceRole !== "renumber") continue;
      expect(componentItemSections).toContain(section);
    }
  });

  it("gives every reference-bearing section at least one alias", () => {
    for (const section of allHeadingItemSections()) {
      if (section.referenceRole === "none") continue;
      expect(section.aliases.length).toBeGreaterThan(0);
    }
  });

  it("includes every nested prose subsection label in the item label set", () => {
    for (const subsection of allProseSections()) {
      expect(itemLabels()).toContain(subsection.rejectNestedLabel);
    }
  });

  it("derives node heading matchers from the canonical reference pattern", () => {
    for (const node of [componentDescriptor, actionItemDescriptor]) {
      const canonical = `${node.refPrefix}1`;
      expect(node.refPattern.test(canonical)).toBe(true);
      expect(node.refPattern.source).toBe(canonicalRefPattern(node.refPrefix).source);
      expect(refHeadingPattern(node.refPrefix, false).test(`${canonical} - Title`)).toBe(true);
      expect(refHeadingPrefix(node.refPrefix, false).test(`${canonical} - Title`)).toBe(true);
      expect(node.placeholderRef).toBe(`${node.refPrefix}New`);
      expect(refHeadingPattern(node.refPrefix, true).test(`${node.placeholderRef} - Title`)).toBe(true);
    }
  });

  it("rejects reference spellings the canonical pattern does not allow", () => {
    // COMPONENT / COMPONENTS were accepted by a legacy heading regex that had drifted
    // from the schema. Deriving every matcher from one prefix removes that divergence.
    const pattern = refHeadingPrefix(componentDescriptor.refPrefix, false);
    expect(pattern.test("COMPONENT 1 - Title")).toBe(false);
    expect(pattern.test("COMPONENTS-1 - Title")).toBe(false);
    expect(pattern.test("comp-1 - Title")).toBe(false);
    expect(pattern.test("COMP-1 - Title")).toBe(true);
  });

  it("gives every section a shape-appropriate configuration", () => {
    for (const section of allSections()) {
      if (isHeadingItems(section)) {
        expect(section.itemDepth).toBeGreaterThan(section.sectionDepth);
        expect(section.singularLabel.length).toBeGreaterThan(0);
        continue;
      }
      if (isBulletList(section)) {
        expect(section.entryLabel.length).toBeGreaterThan(0);
        expect(section.entrySyntax.length).toBeGreaterThan(0);
      }
    }
  });

  it("nests prose subsections deeper than the items that own them", () => {
    for (const section of allHeadingItemSections()) {
      for (const subsection of section.subsections) {
        expect(subsection.depth).toBeGreaterThan(section.itemDepth);
      }
    }
  });
});
