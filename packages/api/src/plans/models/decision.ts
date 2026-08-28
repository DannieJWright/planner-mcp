/**
 * A Decision: a component item carrying a required decision status.
 */
import { z } from "zod";
import type { HeadingItemsSection, ItemModel, ParsedItem } from "./descriptor.js";
import { itemHeading, textItemSchema } from "./textItem.js";

export const decisionStatuses = ["Open", "Decided", "Closed"] as const;

export const decisionSchema = textItemSchema.extend({
  status: z.enum(decisionStatuses),
});

export type Decision = z.infer<typeof decisionSchema>;

export const decisionModel: ItemModel = {
  schema: decisionSchema,
  fromParsed(parsed: ParsedItem, section: HeadingItemsSection) {
    return {
      ref: parsed.ref,
      title: parsed.title ?? `${section.singularLabel} ${parsed.ref}`,
      status: parsed.metadata.Status,
      details: parsed.details,
    };
  },
  format(item, section) {
    const heading = itemHeading(section.itemDepth, section.singularLabel, item.ref as string, item.title as string);
    return `${heading}\n\n**Status:** ${item.status as string}\n\n${item.details as string}`.trimEnd();
  },
  toRow(item) {
    return {
      ref: item.ref as string,
      title: item.title as string,
      details: item.details as string,
      status: item.status as string,
    };
  },
  fromRow(row) {
    return { ref: row.ref, title: row.title, details: row.details, status: row.status };
  },
};

export const decisionsSection = {
  shape: "headingItems",
  key: "decisions",
  heading: "Decisions",
  singularLabel: "Decision",
  aliases: ["decisions?", "decs?", "d"],
  referenceRole: "renumber",
  statuses: decisionStatuses,
  dbKind: "decision",
  required: true,
  sectionDepth: 3,
  itemDepth: 4,
  headingBold: true,
  trimSectionBody: true,
  subsections: [],
  patchFields: ["Status", "Delete", "Handle"],
  model: decisionModel,
} satisfies HeadingItemsSection<"decisions">;
