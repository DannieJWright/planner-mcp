/**
 * Assembled model registry and lookup helpers.
 *
 * Model files declare their own descriptors; this module only aggregates them and
 * provides indexed access. Keeping the direction one-way (models never import the
 * registry) avoids an import cycle and keeps each model file self-contained.
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
export const allSections: SectionDescriptor[] = nodeDescriptors.flatMap((node) => node.sections);

export const allHeadingItemSections: HeadingItemsSection[] = allSections.filter(isHeadingItems);
export const allBulletListSections: BulletListSection[] = allSections.filter(isBulletList);

/** Nested prose subsections declared by any heading-item section, e.g. Findings. */
export const allProseSections: ProseSection[] = allHeadingItemSections
  .flatMap((section) => section.subsections)
  .filter(isProse);

/** Every singular item label that may begin a `####` item heading. */
export const itemLabels: string[] = [
  ...new Set([
    ...allHeadingItemSections.map((section) => section.singularLabel),
    ...allProseSections.map((subsection) => subsection.rejectNestedLabel),
  ]),
];

/** Sections whose items are renumbered and whose references are rewritten in prose. */
export const referenceSections: HeadingItemsSection[] = componentItemSections.filter(
  (section) => section.referenceRole === "renumber",
);

/** Sections whose aliases suppress false unresolved-reference reports. */
export const suppressedReferenceSections: HeadingItemsSection[] = allHeadingItemSections.filter(
  (section) => section.referenceRole === "suppress",
);

/** Component item sections that are persisted in the `items` table. */
export const persistedItemSections: HeadingItemsSection[] = componentItemSections.filter(
  (section) => section.dbKind !== null,
);

function indexBy<T>(entries: T[], key: (entry: T) => string): Map<string, T> {
  return new Map(entries.map((entry) => [key(entry), entry]));
}

const headingItemsByKey = indexBy(allHeadingItemSections, (section) => section.key);
const componentSectionsByHeading = indexBy(componentItemSections, (section) => section.heading);
const componentSectionsByKey = indexBy(componentItemSections, (section) => section.key);
const sectionsByDbKind = indexBy(persistedItemSections, (section) => section.dbKind!);

/** Look up any heading-item section by its model key. */
export function sectionByKey(key: string): HeadingItemsSection | undefined {
  return headingItemsByKey.get(key);
}

/** Look up a component item section by its `### <heading>` text. */
export function componentSectionByHeading(heading: string): HeadingItemsSection | undefined {
  return componentSectionsByHeading.get(heading);
}

/** Look up a component item section by its model key. */
export function componentSectionByKey(key: string): HeadingItemsSection | undefined {
  return componentSectionsByKey.get(key);
}

/** Look up a component item section by its persistence kind value. */
export function sectionByDbKind(kind: string): HeadingItemsSection | undefined {
  return sectionsByDbKind.get(kind);
}

/** Look up a section of any shape on a node descriptor by its `### <heading>` text. */
export function nodeSectionByHeading(node: NodeDescriptor, heading: string): SectionDescriptor | undefined {
  return node.sections.find((section) => section.heading === heading);
}

export { componentItemSections };
