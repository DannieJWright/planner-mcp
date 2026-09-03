/**
 * Assembled model registry and lookup helpers.
 *
 * Model files declare their own descriptors; this module only aggregates them and
 * provides indexed access. Keeping the direction one-way (models never import the
 * registry) avoids an import cycle and keeps each model file self-contained.
 *
 * Every aggregate is computed on demand rather than captured at module load, so a
 * section registered after startup is visible to parsing, normalization, and
 * persistence. `extensibility.test.ts` depends on this.
 */
import {
  isBulletList,
  isHeadingItems,
  isProse,
  type BulletListSection,
  type HeadingItemsSection,
  type NodeDescriptor,
  type ProseSection,
  type SectionDescriptor,
} from "./descriptor.js";
import { actionItemDescriptor } from "./actionItem.js";
import { componentDescriptor, componentItemSections } from "./component.js";
import { planDescriptor } from "./plan.js";

export const nodeDescriptors: NodeDescriptor[] = [planDescriptor, componentDescriptor, actionItemDescriptor];

/** Every section belonging to any node type. */
export function allSections(): SectionDescriptor[] {
  return nodeDescriptors.flatMap((node) => node.sections);
}

export function allHeadingItemSections(): HeadingItemsSection[] {
  return allSections().filter(isHeadingItems);
}

export function allBulletListSections(): BulletListSection[] {
  return allSections().filter(isBulletList);
}

/** Nested prose subsections declared by any heading-item section, e.g. Findings. */
export function allProseSections(): ProseSection[] {
  return allHeadingItemSections().flatMap((section) => section.subsections).filter(isProse);
}

/**
 * Every singular item label that may begin a `####` item heading.
 *
 * Re-exported from the plan model, which owns the single implementation next to the
 * collections it derives. The registry cannot host it because models must not import the
 * registry; a second derivation here is exactly the parallel table this project bans.
 */
export { itemLabels } from "./plan.js";

/** Every heading-item section declared by one node type, in descriptor order. */
export function headingItemSections(node: NodeDescriptor): HeadingItemsSection[] {
  return node.sections.filter(isHeadingItems);
}

/**
 * Sections whose items are renumbered and whose references are rewritten in prose.
 *
 * Scopes over every node type on purpose: a section registered under an action item with
 * the renumber role participates in normalization exactly like one declared on a
 * component, instead of being skipped silently.
 */
export function referenceSections(): Array<HeadingItemsSection<string>> {
  return allHeadingItemSections().filter((section) => section.referenceRole === "renumber");
}

/** The renumber-role sections declared by one node type. */
export function referenceSectionsFor(node: NodeDescriptor): Array<HeadingItemsSection<string>> {
  return headingItemSections(node).filter((section) => section.referenceRole === "renumber");
}

/** Sections whose aliases only suppress false unresolved-reference reports. */
export function suppressedReferenceSections(): HeadingItemsSection[] {
  return allHeadingItemSections().filter((section) => section.referenceRole === "suppress");
}

/** Every heading-item section that carries a persistence kind, on any node type. */
export function persistedItemSections(): Array<HeadingItemsSection<string>> {
  return allHeadingItemSections().filter((section) => section.dbKind !== null);
}

/** The sections declared by one node type that carry a persistence kind. */
export function persistedItemSectionsFor(node: NodeDescriptor): Array<HeadingItemsSection<string>> {
  return headingItemSections(node).filter((section) => section.dbKind !== null);
}

/** Look up any heading-item section by its model key. */
export function sectionByKey(key: string): HeadingItemsSection | undefined {
  return allHeadingItemSections().find((section) => section.key === key);
}

/** Look up a component item section by its `### <heading>` text. */
export function componentSectionByHeading(heading: string): HeadingItemsSection | undefined {
  return componentItemSections.find((section) => section.heading === heading);
}

/** Look up a component item section by its model key. */
export function componentSectionByKey(key: string): HeadingItemsSection | undefined {
  return componentItemSections.find((section) => section.key === key);
}

/** Look up any heading-item section by its persistence kind value. */
export function sectionByDbKind(kind: string): HeadingItemsSection | undefined {
  return persistedItemSections().find((section) => section.dbKind === kind);
}

/** Look up a section of any shape on a node descriptor by its `### <heading>` text. */
export function nodeSectionByHeading(node: NodeDescriptor, heading: string): SectionDescriptor | undefined {
  return node.sections.find((section) => section.heading === heading);
}

export { componentItemSections };
