/**
 * A Knowledge Gap: a component item with a status and a nested `##### Findings` prose
 * subsection whose content is required once the gap is Resolved.
 *
 * Findings is modelled as a `prose` subsection rather than a model of its own: it has no
 * reference, no status, and no items — it is a named body of Markdown belonging to its
 * parent item.
 */
import { z } from "zod";
import type { HeadingItemsSection, ItemModel, ParsedItem, ProseSection } from "./descriptor.js";
import { itemHeading, textItemSchema } from "./textItem.js";

export const knowledgeGapStatuses = ["Open", "Resolved", "Closed"] as const;

/** Statuses that require the Findings subsection to be non-empty. */
const statusesRequiringFindings = ["Resolved"] as const;

export const findingsSection = {
  shape: "prose",
  key: "findings",
  heading: "Findings",
  depth: 5,
  required: true,
  rejectNestedLabel: "Finding",
  requiredForStatuses: statusesRequiringFindings,
} satisfies ProseSection<"findings">;

export const knowledgeGapSchema = textItemSchema.extend({
  status: z.enum(knowledgeGapStatuses),
  findings: z.string(),
}).refine(
  (gap) => !statusesRequiringFindings.includes(gap.status as typeof statusesRequiringFindings[number])
    || gap.findings.trim().length > 0,
  {
    message: "Resolved knowledge gaps must contain findings",
    path: [findingsSection.key],
  },
);

export type KnowledgeGap = z.infer<typeof knowledgeGapSchema>;

export const knowledgeGapModel: ItemModel = {
  schema: knowledgeGapSchema,
  fromParsed(parsed: ParsedItem, section: HeadingItemsSection) {
    return {
      ref: parsed.ref,
      title: parsed.title ?? `${section.singularLabel} ${parsed.ref}`,
      status: parsed.metadata.Status,
      details: parsed.details,
      findings: parsed.subsections[findingsSection.key] ?? "",
    };
  },
  format(item, section) {
    const heading = itemHeading(section.itemDepth, section.singularLabel, item.ref as string, item.title as string);
    const findingsHeading = `${"#".repeat(findingsSection.depth)} ${findingsSection.heading}`;
    return [
      heading,
      `**Status:** ${item.status as string}`,
      item.details as string,
      findingsHeading,
      item[findingsSection.key] as string,
    ].join("\n\n").trimEnd();
  },
  toRow(item) {
    return {
      ref: item.ref as string,
      title: item.title as string,
      details: item.details as string,
      status: item.status as string,
    };
  },
  fromRow(row, subsections) {
    return {
      ref: row.ref,
      title: row.title,
      details: row.details,
      status: row.status,
      [findingsSection.key]: (subsections[findingsSection.key] ?? []).join("\n\n"),
    };
  },
};

export const knowledgeGapsSection = {
  shape: "headingItems",
  key: "knowledgeGaps",
  heading: "Knowledge Gaps",
  singularLabel: "Knowledge Gap",
  aliases: ["knowledge\\s+gaps?", "k\\.?g\\.?", "findings?", "f"],
  referenceRole: "renumber",
  statuses: knowledgeGapStatuses,
  dbKind: "knowledge_gap",
  required: true,
  sectionDepth: 3,
  itemDepth: 4,
  headingBold: true,
  trimSectionBody: true,
  subsections: [findingsSection],
  patchFields: ["Status", "Delete", "Handle"],
  model: knowledgeGapModel,
} satisfies HeadingItemsSection<"knowledgeGaps">;
