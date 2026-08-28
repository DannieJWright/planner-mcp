/**
 * An Action Item: the `## **ACTION-<n> - <title>**` node.
 *
 * Its three subsections have two different shapes. Acceptance Criteria is a heading-item
 * section reusing the generic text item model; Trigger Sources and Assignees are bullet
 * lists. Both shapes are described by the same section registry, so the parser, the
 * formatter, and the patch engine iterate one list rather than special-casing names.
 */
import { z } from "zod";
import type { BulletListSection, NodeDescriptor, SectionDescriptor } from "./descriptor.js";
import { canonicalRefPattern, placeholderRef } from "../shared/refs.js";
import { textItemSchema, textSection } from "./textItem.js";

const refPrefix = "ACTION-";

export const actionItemStatuses = ["TODO", "In Progress", "Done", "Closed"] as const;

export const triggerSourceSchema = z.object({
  ref: z.string().min(1),
  title: z.string().min(1),
});

export type TriggerSource = z.infer<typeof triggerSourceSchema>;

/**
 * Acceptance Criteria are referenced in prose but are never renumbered by the component
 * reference pass, so their alias only suppresses false "unresolved reference" reports.
 */
export const acceptanceCriteriaSection = textSection({
  key: "acceptanceCriteria",
  heading: "Acceptance Criteria",
  singularLabel: "Acceptance Criteria",
  aliases: ["acceptance\\s+criteria"],
  referenceRole: "suppress",
  dbKind: null,
  patchFields: ["Delete", "Handle"],
});

export const triggerSourcesSection = {
  shape: "bulletList",
  key: "triggerSources",
  heading: "Trigger Sources",
  required: true,
  sectionDepth: 3,
  entryLabel: "trigger source",
  entrySyntax: "- <reference> - <short description>",
  decodeEntry: (entry) => {
    const match = entry.match(/^(.+?)\s+-\s+(.+)$/);
    return match ? { ref: match[1]!, title: match[2]! } : undefined;
  },
  encodeEntry: (value: never) => {
    const source = value as unknown as TriggerSource;
    return `${source.ref} - ${source.title}`;
  },
} satisfies BulletListSection;

export const assigneesSection = {
  shape: "bulletList",
  key: "assignees",
  heading: "Assignees",
  required: true,
  sectionDepth: 3,
  entryLabel: "assignee",
  entrySyntax: "- <name>",
  decodeEntry: (entry) => entry,
  encodeEntry: (value: never) => String(value),
} satisfies BulletListSection;

/** The three action-item subsections, in canonical document order. */
export const actionItemSections: SectionDescriptor[] = [
  acceptanceCriteriaSection,
  triggerSourcesSection,
  assigneesSection,
];

export const actionItemSchema = z.object({
  ref: z.string().regex(canonicalRefPattern(refPrefix)),
  title: z.string().min(1),
  status: z.enum(actionItemStatuses),
  context: z.string(),
  acceptanceCriteria: z.array(textItemSchema),
  triggerSources: z.array(triggerSourceSchema),
  assignees: z.array(z.string().min(1)),
});

export type ActionItem = z.infer<typeof actionItemSchema>;

export const actionItemDescriptor: NodeDescriptor = {
  key: "actionItem",
  label: "action item",
  refPattern: canonicalRefPattern(refPrefix),
  refPrefix,
  placeholderRef: placeholderRef(refPrefix),
  headingDepth: 2,
  containerHeading: "Action Items",
  statuses: actionItemStatuses,
  patchFields: ["Status", "Delete", "Position", "Handle"],
  sections: actionItemSections,
};
