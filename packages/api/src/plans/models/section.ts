/**
 * Generic section walkers.
 *
 * These functions know how to traverse and render the three section *shapes*; they know
 * nothing about which sections exist. Everything specific comes from the descriptor
 * passed in, so adding a section adds no code here.
 *
 * Strict and partial parsing share one traversal. The mode only changes how the leading
 * metadata block is interpreted: a strict document carries a bare `**Status:** value`
 * line, while a partial document may carry any of the descriptor's declared patch
 * fields.
 */
import {
  contentBetween,
  headingIndexes,
  headingText,
  nodeText,
  parseLeadingMetadata,
  type MarkdownNode,
} from "../shared/ast.js";
import {
  duplicateNestedSubsection,
  duplicateSubsection,
  headingLiteral,
  invalidBullet,
  invalidItemHeading,
  invalidStatus,
  missingSubsection,
  nestedItemInProse,
  resolvedWithEmptyProse,
  unsupportedSubsection,
} from "../shared/errors.js";
import type {
  BulletListSection,
  HeadingItemsSection,
  NodeRange,
  ParseContext,
  ParsedItem,
  ProseSection,
} from "./descriptor.js";

/** Escape a literal for embedding in a regular expression. */
function escape(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the `#### <Label> <ref> - <title>` matcher from the registry's label set.
 *
 * Longer labels are tried first so `Acceptance Criteria` is not shadowed by a shorter
 * label sharing its prefix.
 */
export function itemHeadingPattern(labels: string[]): RegExp {
  const alternation = [...labels].sort((left, right) => right.length - left.length).map(escape).join("|");
  return new RegExp(`^(?:${alternation})\\s+([\\w.-]+)(?:\\s*[-:]\\s*(.*))?$`, "i");
}

/** Parse an item heading into its reference and optional title. */
export function parseItemHeading(heading: string, labels: string[]): { ref: string; title?: string } | undefined {
  const match = heading.trim().match(itemHeadingPattern(labels));
  if (!match) return undefined;
  const title = match[2]?.trim();
  return title ? { ref: match[1]!, title } : { ref: match[1]! };
}

/** Render `### **Heading**` or `### Heading` according to the descriptor. */
export function sectionHeading(section: { sectionDepth: number; heading: string; headingBold: boolean }): string {
  return headingLiteral(section.sectionDepth, section.headingBold ? `**${section.heading}**` : section.heading);
}

const statusLinePattern = /^(?:\*\*)?Status:(?:\*\*)?\s*([^\n]+)\s*(?:\n\n|\n)?/i;

/**
 * Locate each nested prose subsection of an item and return the body index at which the
 * item's own details end.
 */
function readSubsections(
  ctx: ParseContext,
  section: HeadingItemsSection,
  owner: string,
  itemStart: number,
  itemEnd: number,
): { bodyEnd: number; subsections: Record<string, string>; present: Set<string> } {
  const subsections: Record<string, string> = {};
  const present = new Set<string>();
  let bodyEnd = itemEnd;

  for (const subsection of section.subsections) {
    const found = headingIndexes(ctx.nodes, itemStart + 1, itemEnd, subsection.depth)
      .filter((index) => headingText(ctx.nodes[index]!) === subsection.heading);
    if (found.length === 0) {
      if (ctx.mode === "strict" && subsection.required) {
        throw missingSubsection(ctx.nodes[itemStart]!, owner, subsection.depth, subsection.heading);
      }
      continue;
    }
    if (found.length > 1) {
      throw duplicateNestedSubsection(ctx.nodes[found[1]!]!, owner, subsection.depth, subsection.heading);
    }
    const start = found[0]!;
    rejectNestedItemHeadings(ctx, subsection, start, itemEnd);
    subsections[subsection.key] = contentBetween(
      ctx.source,
      ctx.nodes.slice(0, itemEnd),
      start + 1,
      subsection.depth,
    );
    present.add(subsection.key);
    bodyEnd = Math.min(bodyEnd, start);
  }

  return { bodyEnd, subsections, present };
}

/** Prose subsections hold free text, not further items. */
function rejectNestedItemHeadings(
  ctx: ParseContext,
  subsection: ProseSection,
  start: number,
  end: number,
): void {
  const pattern = new RegExp(`^${escape(subsection.rejectNestedLabel)}\\s+`, "i");
  for (let index = start + 1; index < end; index += 1) {
    const node = ctx.nodes[index]!;
    if (node.type !== "heading") continue;
    const text = nodeText(node).trim();
    if (pattern.test(text)) throw nestedItemInProse(node, subsection.heading, subsection.depth, text);
  }
}

/**
 * Extract the leading metadata block of an item body.
 *
 * Strict documents only ever carry a status line, and unknown `**Key:** value` lines are
 * left in the prose. Partial documents validate against the descriptor's patch fields.
 */
function readMetadata(
  ctx: ParseContext,
  section: HeadingItemsSection,
  owner: string,
  body: string,
): { metadata: Record<string, string>; details: string } {
  if (ctx.mode === "partial") {
    const { fields, rest } = parseLeadingMetadata(body, section.patchFields, owner);
    return { metadata: fields, details: rest };
  }
  if (section.statuses === null) return { metadata: {}, details: body };
  const match = body.match(statusLinePattern);
  const metadata: Record<string, string> = {};
  if (match) metadata.Status = match[1]!.trim();
  return { metadata, details: match ? body.slice(match[0].length).trim() : body };
}

/** Normalize a supplied status against the descriptor's allowed values. */
export function resolveStatus(
  allowed: readonly string[],
  supplied: string | undefined,
): string | undefined {
  return allowed.find((candidate) => candidate.toLowerCase() === supplied?.toLowerCase());
}

/**
 * Node indexes at which each item in a section begins.
 *
 * A section whose items own nested subsections identifies its items by label, so a
 * deeper-nested heading that happens to sit at the item depth cannot split an item in
 * two. Sections without subsections accept any item heading, which is what lets a
 * document use, say, a `#### Note` heading inside the Requirements section.
 */
function itemStartIndexes(ctx: ParseContext, section: HeadingItemsSection, range: NodeRange): number[] {
  const starts = headingIndexes(ctx.nodes, range.start, range.end, section.itemDepth);
  if (section.subsections.length === 0) return starts;
  const pattern = new RegExp(`^${escape(section.singularLabel)}\\s+`, "i");
  return starts.filter((index) => pattern.test(headingText(ctx.nodes[index]!)));
}

/**
 * Walk a heading-item section and return one `ParsedItem` per `####` heading.
 *
 * The result is deliberately shape-neutral: `component.ts` projects it into domain items
 * through the item model, and the patch engine projects the same structure into patch
 * operations.
 */
export function parseHeadingItems(
  ctx: ParseContext,
  section: HeadingItemsSection,
  range: NodeRange,
): ParsedItem[] {
  const starts = itemStartIndexes(ctx, section, range);
  return starts.map((itemStart, order) => {
    const node = ctx.nodes[itemStart]!;
    const heading = headingText(node);
    const parsed = parseItemHeading(heading, ctx.labels);
    if (!parsed) throw invalidItemHeading(node, heading, ctx.labels[0]!, section.itemDepth);

    const itemEnd = starts[order + 1] ?? range.end;
    const owner = `${section.singularLabel} ${parsed.ref}`;
    const { bodyEnd, subsections, present } = readSubsections(ctx, section, owner, itemStart, itemEnd);
    const body = contentBetween(ctx.source, ctx.nodes.slice(0, bodyEnd), itemStart + 1, section.itemDepth);
    const { metadata, details } = readMetadata(ctx, section, owner, body);

    if (ctx.mode === "strict" && section.statuses !== null) {
      const status = resolveStatus(section.statuses, metadata.Status);
      if (!status) throw invalidStatus(node, heading, metadata.Status, section.statuses);
      metadata.Status = status;
      for (const subsection of section.subsections) {
        if (!subsection.requiredForStatuses.includes(status)) continue;
        if ((subsections[subsection.key] ?? "").length > 0) continue;
        throw resolvedWithEmptyProse(node, heading, status, subsection.heading);
      }
    }

    const item: ParsedItem = {
      ref: parsed.ref,
      metadata,
      details,
      subsections,
      presentSubsections: present,
      node,
    };
    if (parsed.title !== undefined) item.title = parsed.title;
    return item;
  });
}

/** Read the raw text of every entry in the first bullet list of a section. */
export function parseBulletEntries(ctx: ParseContext, range: NodeRange): string[] {
  const list = ctx.nodes.slice(range.start, range.end).find((node) => node.type === "list");
  if (list?.type !== "list") return [];
  return (list.children ?? []).map((entry) => nodeText(entry).trim()).filter(Boolean);
}

/** Decode a bullet-list section into its stored values. */
export function parseBulletList(
  ctx: ParseContext,
  section: BulletListSection,
  range: NodeRange,
): unknown[] {
  return parseBulletEntries(ctx, range).map((entry) => {
    const decoded = section.decodeEntry(entry);
    if (decoded === undefined) throw invalidBullet(section.entryLabel, entry, section.entrySyntax);
    return decoded;
  });
}

/** Render a heading-item section, including its heading. */
export function formatHeadingItems(
  section: HeadingItemsSection,
  items: Array<Record<string, unknown>>,
): string {
  const body = items.map((item) => section.model.format(item, section)).join("\n\n");
  const rendered = `${sectionHeading(section)}\n\n${body}`;
  return section.trimSectionBody ? rendered.trimEnd() : rendered;
}

/** Render a bullet-list section, including its heading. */
export function formatBulletList(section: BulletListSection, values: unknown[]): string {
  const body = values.map((value) => `- ${section.encodeEntry(value as never)}`).join("\n");
  const rendered = `${sectionHeading(section)}\n\n${body}`;
  return section.trimSectionBody ? rendered.trimEnd() : rendered;
}

/** Index every `### <heading>` a node declares, keyed by heading text. */
export function sectionIndexes(
  nodes: MarkdownNode[],
  range: NodeRange,
  depth: number,
): Array<{ heading: string; index: number }> {
  return headingIndexes(nodes, range.start, range.end, depth)
    .map((index) => ({ heading: headingText(nodes[index]!), index }));
}

/**
 * Match the `###` headings inside a node against the sections it declares and return the
 * node range covered by each.
 *
 * Unknown and duplicated headings are always rejected. Missing required sections are
 * rejected only in strict mode, because a partial document is expected to omit anything
 * it is not changing. This is the single implementation used by the strict parser and
 * the patch parser alike.
 */
export function locateSections<T extends { heading: string; required: boolean }>(
  ctx: ParseContext,
  owner: string,
  sections: readonly T[],
  range: NodeRange,
  depth: number,
): Map<T, NodeRange> {
  const found = new Map<T, number>();
  for (const { heading, index } of sectionIndexes(ctx.nodes, { start: range.start + 1, end: range.end }, depth)) {
    const section = sections.find((candidate) => candidate.heading === heading);
    if (!section) throw unsupportedSubsection(ctx.nodes[index]!, owner, depth, heading);
    if (found.has(section)) throw duplicateSubsection(ctx.nodes[index]!, owner, depth, heading);
    found.set(section, index);
  }
  if (ctx.mode === "strict") {
    for (const section of sections) {
      if (section.required && !found.has(section)) {
        throw missingSubsection(ctx.nodes[range.start], owner, depth, section.heading);
      }
    }
  }

  const boundaries = [...found.values()].sort((left, right) => left - right);
  const ranges = new Map<T, NodeRange>();
  for (const [section, start] of found) {
    ranges.set(section, { start: start + 1, end: boundaries.find((value) => value > start) ?? range.end });
  }
  return ranges;
}
