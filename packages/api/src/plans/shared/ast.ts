/**
 * Generic Markdown AST helpers.
 *
 * Nothing in this module knows about plans, components, or item types. It deals only
 * in mdast nodes, heading depths, and source ranges. Model-specific identification
 * lives in the descriptors under `../models/`.
 */
import { fromMarkdown } from "mdast-util-from-markdown";

type Node = {
  type: string;
  depth?: number;
  value?: string;
  children?: Node[];
  position?: {
    start: { line?: number; offset?: number };
    end: { offset?: number };
  };
};

export type MarkdownNode = Node;

/** Recursively recover the text content of a node. */
export function nodeText(node: Node): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join("");
}

/** Heading text with Markdown bold markers removed and surrounding whitespace trimmed. */
export function headingText(node: Node): string {
  return nodeText(node).replace(/\*\*/g, "").trim();
}

/** ` on line <n>` suffix for error messages, or an empty string when unavailable. */
export function lineLocation(node: Node): string {
  return node.position?.start.line === undefined ? "" : ` on line ${node.position.start.line}`;
}

/** Parse a Markdown body (frontmatter already stripped) into its top-level mdast nodes. */
export function parseMarkdownNodes(content: string): MarkdownNode[] {
  return (fromMarkdown(content) as Node).children ?? [];
}

/** Indexes of every heading of exactly `depth` within `[start, end)`. */
export function headingIndexes(nodes: MarkdownNode[], start: number, end: number, depth: number): number[] {
  const indexes: number[] = [];
  for (let index = start; index < end; index += 1) {
    const node = nodes[index]!;
    if (node.type === "heading" && node.depth === depth) indexes.push(index);
  }
  return indexes;
}

/** Index of the next heading at or above `depth` within `[start, end)`, else `end`. */
export function nextBoundary(nodes: MarkdownNode[], start: number, end: number, depth: number): number {
  for (let index = start; index < end; index += 1) {
    const node = nodes[index]!;
    if (node.type === "heading" && (node.depth ?? 7) <= depth) return index;
  }
  return end;
}

/**
 * Original Markdown source from `nodes[start]` up to the next heading at or above
 * `headingDepth`.
 *
 * This slices the source text using mdast position offsets rather than re-serializing
 * the subtree, which preserves the author's exact formatting: fenced code, tables,
 * blockquotes, and hard line breaks all survive a round trip byte for byte. Swapping to
 * `mdast-util-to-markdown` would reformat user content, so it is deliberately deferred;
 * this function is the single site that would change.
 */
export function contentBetween(markdown: string, nodes: Node[], start: number, headingDepth: number): string {
  let end = start;
  for (let index = start; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.type === "heading" && (node.depth ?? 7) <= headingDepth) break;
    end = index + 1;
  }
  if (end === start) return "";
  const startOffset = nodes[start]?.position?.start.offset;
  const endOffset = nodes[end - 1]?.position?.end.offset;
  if (startOffset === undefined || endOffset === undefined) throw new Error("Markdown node is missing source position");
  return markdown.slice(startOffset, endOffset).trim();
}

export type LeadingMetadata = { fields: Record<string, string>; rest: string };

/** A leading status line plus the body text that follows it. */
export type StatusLine = { status?: string; rest: string };

const statusLinePattern = /^(?:\*\*)?Status:(?:\*\*)?\s*([^\n]+)\s*(?:\n\n|\n)?/i;

/**
 * Read the leading `**Status:** value` line of a body, or an unbolded `Status: value`
 * line. Strict documents have always tolerated the unbolded form while partial documents
 * never did (they read metadata exclusively through `parseLeadingMetadata`, which requires
 * bold); this is the single shared implementation behind that tolerance. The captured
 * status is returned exactly as written; callers decide how to normalize it. When no
 * leading status line exists, the body is returned untouched in `rest`.
 */
export function readStatusLine(body: string): StatusLine {
  const match = body.match(statusLinePattern);
  if (!match) return { rest: body };
  return { status: match[1], rest: body.slice(match[0].length).trim() };
}

/**
 * Split a body into its leading `**Key:** value` metadata block and the remaining prose.
 *
 * Only bold markers are recognized here, which is exactly what partial documents require;
 * the strict parser's tolerance of an unbolded `Status:` line lives in `readStatusLine`,
 * not in this function.
 */
export function parseLeadingMetadata(
  body: string,
  allowedKeys: readonly string[],
  context: string,
): LeadingMetadata {
  const fields: Record<string, string> = {};
  const lines = body.split("\n");
  const isMetadataLine = (value: string): boolean =>
    /^\*\*[A-Za-z][A-Za-z ]*:\*\*/.test(value);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "") {
      const next = lines.slice(index + 1).find((value) => value.trim() !== "");
      if (next === undefined || !isMetadataLine(next.trim())) break;
      index += 1;
      continue;
    }
    const trimmed = line.trim();
    const match = trimmed.match(/^\*\*([A-Za-z][A-Za-z ]*):\*\*\s*(.*)$/)
      ?? (isMetadataLine(trimmed) ? trimmed.match(/^([A-Za-z][A-Za-z ]*):\s*(.*)$/) : null);
    if (!match) break;
    const key = match[1]!.trim();
    const allowed = allowedKeys.find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (!allowed) {
      throw new Error(`Plan Markdown error: ${context} contains unsupported metadata field \`${key}\`. Allowed fields are ${allowedKeys.join(", ")}.`);
    }
    if (allowed in fields) throw new Error(`Plan Markdown error: ${context} contains duplicate metadata field \`${allowed}\`.`);
    fields[allowed] = match[2]!.trim();
    index += 1;
  }
  return { fields, rest: lines.slice(index).join("\n").trim() };
}
