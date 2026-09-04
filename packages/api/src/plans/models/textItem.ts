/**
 * The generic component item: a `#### <Label> <ref> - <title>` heading with a prose body
 * and no status.
 *
 * Requirements, Constraints, Notes, and Open Questions are all this shape; they differ
 * only in their descriptor values, so they share one model and one section factory
 * rather than four near-identical files.
 */
import { z } from "zod";
import { patchFieldNames } from "./descriptor.js";
import type { HeadingItemsSection, ItemModel, PatchFieldName, ParsedItem, ReferenceRole } from "./descriptor.js";

export const textItemSchema = z.object({
  ref: z.string().min(1),
  title: z.string().min(1),
  details: z.string(),
});

export type TextItem = z.infer<typeof textItemSchema>;

/** Canonical `<Label> <ref>` heading suffix, omitted when the title adds nothing. */
export function itemHeading(depth: number, label: string, ref: string, title: string): string {
  const suffix = title === `${label} ${ref}` ? "" : ` - ${title}`;
  return `${"#".repeat(depth)} ${label} ${ref}${suffix}`;
}

export const textItemModel: ItemModel = {
  schema: textItemSchema,
  fromParsed(parsed: ParsedItem, section: HeadingItemsSection) {
    const details = section.detailsTransform ? section.detailsTransform.decode(parsed.details) : parsed.details;
    return { ref: parsed.ref, title: parsed.title ?? `${section.singularLabel} ${parsed.ref}`, details };
  },
  format(item, section) {
    const ref = item.ref as string;
    const title = item.title as string;
    const raw = item.details as string;
    const details = section.detailsTransform ? section.detailsTransform.encode(raw) : raw;
    return `${itemHeading(section.itemDepth, section.singularLabel, ref, title)}\n\n${details}`.trimEnd();
  },
  toRow(item) {
    return { ref: item.ref as string, title: item.title as string, details: item.details as string, status: null };
  },
  fromRow(row) {
    return { ref: row.ref, title: row.title, details: row.details };
  },
};

export type TextSectionOptions<Key extends string> = {
  key: Key;
  heading: string;
  singularLabel: string;
  aliases: string[];
  dbKind: string | null;
  referenceRole?: ReferenceRole;
  required?: boolean;
  sectionDepth?: number;
  itemDepth?: number;
  headingBold?: boolean;
  trimSectionBody?: boolean;
  detailsTransform?: HeadingItemsSection["detailsTransform"];
  patchFields?: readonly PatchFieldName[];
};

/** Build a status-free heading-item section descriptor. */
export function textSection<Key extends string>(options: TextSectionOptions<Key>): HeadingItemsSection<Key> {
  const section: HeadingItemsSection<Key> = {
    shape: "headingItems",
    key: options.key,
    heading: options.heading,
    singularLabel: options.singularLabel,
    aliases: options.aliases,
    referenceRole: options.referenceRole ?? "renumber",
    statuses: null,
    dbKind: options.dbKind,
    required: options.required ?? true,
    sectionDepth: options.sectionDepth ?? 3,
    itemDepth: options.itemDepth ?? 4,
    headingBold: options.headingBold ?? true,
    trimSectionBody: options.trimSectionBody ?? true,
    subsections: [],
    patchFields: options.patchFields ?? [patchFieldNames.status, patchFieldNames.delete, patchFieldNames.handle],
    model: textItemModel,
  };
  if (options.detailsTransform) section.detailsTransform = options.detailsTransform;
  return section;
}
