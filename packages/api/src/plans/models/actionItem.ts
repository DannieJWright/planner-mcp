/**
 * An Action Item: the `## **ACTION-<n> - <title>**` node.
 *
 * Its three subsections have two different shapes. Acceptance Criteria is a heading-item
 * section reusing the generic text item model; Trigger Sources and Assignees are bullet
 * lists. Both shapes are described by the same section registry, so the parser, the
 * formatter, and the patch engine iterate one list rather than special-casing names.
 */
import { z } from "zod";
import {
  isBulletList,
  isHeadingItems,
  type BulletListSection,
  type NodeDescriptor,
  type NodeRange,
  type ParseContext,
  type SectionDescriptor,
} from "./descriptor.js";
import { contentBetween, headingText, readStatusLine } from "../shared/ast.js";
import { invalidNodeHeading, invalidStatus } from "../shared/errors.js";
import { canonicalRefPattern, placeholderRef, refHeadingPattern } from "../shared/refs.js";
import {
  formatBulletList,
  formatHeadingItems,
  locateSections,
  parseBulletList,
  parseHeadingItems,
  resolveStatus,
} from "./section.js";
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
  headingBold: false,
  trimSectionBody: false,
});

export const triggerSourcesSection = {
  shape: "bulletList",
  key: "triggerSources",
  heading: "Trigger Sources",
  required: true,
  sectionDepth: 3,
  headingBold: false,
  trimSectionBody: false,
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
  headingBold: false,
  trimSectionBody: true,
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
  headingBold: true,
  containerHeading: "Action Items",
  statuses: actionItemStatuses,
  patchFields: ["Status", "Delete", "Position", "Handle"],
  sections: actionItemSections,
};


function headingSyntax(allowPlaceholder: boolean): string {
  const number = allowPlaceholder ? "<number|New>" : "<number>";
  return `## **${refPrefix}${number} - <title>**`;
}

/**
 * Parse one action item and each of its subsections.
 *
 * The two subsection shapes are dispatched by `shape`, not by name, so Acceptance
 * Criteria reuses the same heading-item walker the component sections use.
 */
export function parseActionItem(ctx: ParseContext, range: NodeRange): ActionItem {
  const node = ctx.nodes[range.start]!;
  const heading = headingText(node);
  const allowPlaceholder = ctx.mode === "partial";
  const match = heading.match(refHeadingPattern(refPrefix, allowPlaceholder));
  if (!match) throw invalidNodeHeading(node, actionItemDescriptor.label, heading, headingSyntax(allowPlaceholder));
  const ref = match[1]!;

  const found = locateSections(ctx, ref, actionItemSections, range, 3);
  const rangeFor = (section: SectionDescriptor): NodeRange =>
    found.get(section) ?? { start: range.end, end: range.end };

  const preamble = contentBetween(ctx.source, ctx.nodes, range.start + 1, 3);
  const { status: supplied, rest } = readStatusLine(preamble);
  const status = resolveStatus(actionItemStatuses, supplied);
  if (!status) throw invalidStatus(node, ref, supplied, actionItemStatuses);

  const action = {
    ref,
    title: match[2]!.trim(),
    status,
    context: rest,
  } as unknown as Record<string, unknown>;
  for (const section of actionItemSections) {
    if (isHeadingItems(section)) {
      action[section.key] = parseHeadingItems(ctx, section, rangeFor(section))
        .map((item) => section.model.fromParsed(item, section));
      continue;
    }
    if (isBulletList(section)) action[section.key] = parseBulletList(ctx, section, rangeFor(section));
  }
  return action as unknown as ActionItem;
}

/** Render one action item and each of its subsections, in descriptor order. */
export function formatActionItem(action: ActionItem): string {
  const record = action as unknown as Record<string, unknown>;
  const heading = actionItemDescriptor.headingBold
    ? `## **${action.ref} - ${action.title}**`
    : `## ${action.ref} - ${action.title}`;
  const sections = actionItemSections.map((section) => {
    if (isHeadingItems(section)) {
      return formatHeadingItems(section, record[section.key] as Array<Record<string, unknown>>);
    }
    return formatBulletList(section as BulletListSection, record[section.key] as unknown[]);
  });
  return [heading, `**Status:** ${action.status}`, action.context, ...sections].join("\n\n").trimEnd();
}
