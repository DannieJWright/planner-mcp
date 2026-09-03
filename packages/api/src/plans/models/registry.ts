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

/** Sections whose items are renumbered and whose references are rewritten in prose. */
export function referenceSections(): Array<HeadingItemsSection<string>> {
  return componentItemSections.filter((section) => section.referenceRole === "renumber");
}

/** Sections whose aliases only suppress false unresolved-reference reports. */
export function suppressedReferenceSections(): HeadingItemsSection[] {
  return allHeadingItemSections().filter((section) => section.referenceRole === "suppress");
}

/** Component item sections that are persisted in the `items` table. */
export function persistedItemSections(): Array<HeadingItemsSection<string>> {
  return componentItemSections.filter((section) => section.dbKind !== null);
}

/** Index of persistence kind to section, built once per read. */
export function dbKindIndex(): Map<string, HeadingItemsSection<string>> {
  return new Map(persistedItemSections().map((section) => [section.dbKind!, section]));
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

/** Look up a component item section by its persistence kind value. */
export function sectionByDbKind(kind: string): HeadingItemsSection | undefined {
  return persistedItemSections().find((section) => section.dbKind === kind);
}

/** Look up a section of any shape on a node descriptor by its `### <heading>` text. */
export function nodeSectionByHeading(node: NodeDescriptor, heading: string): SectionDescriptor | undefined {
  return node.sections.find((section) => section.heading === heading);
}

export { componentItemSections };
