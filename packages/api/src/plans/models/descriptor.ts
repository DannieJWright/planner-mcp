/**
 * Descriptor types for the plan model system.
 *
 * A descriptor is the single place that owns every *name* belonging to a model type:
 * its heading text, singular item label, model key, reference aliases, status values,
 * persistence kind, and patch-protocol vocabulary. Parsing, formatting, persistence
 * mapping, and patch processing all read these values instead of spelling literals at
 * call sites.
 *
 * Adding a new section means adding one descriptor entry (and, for a new item shape,
 * one model module). See `docs/MODELS.md`.
 */
import type { z } from "zod";
import type { MarkdownNode } from "../shared/ast.js";

/** Strict parsing enforces required sections and complete values; partial does not. */
export type ParseMode = "strict" | "partial";

/** A half-open `[start, end)` range of top-level mdast node indexes. */
export type NodeRange = { start: number; end: number };

/** Everything a parser needs to read a document once. */
export type ParseContext = {
  /** Markdown body with frontmatter already removed. */
  source: string;
  nodes: MarkdownNode[];
  mode: ParseMode;
};

/**
 * One item heading plus its body, as recovered by the generic section walker.
 *
 * Both the strict and the partial parser produce these; they differ only in how the
 * result is projected (into a domain node, or into a patch operation).
 */
export type ParsedItem = {
  ref: string;
  /** Present only when the heading carried a ` - <title>` suffix. */
  title?: string;
  /** Leading `**Key:** value` fields declared by the owning descriptor. */
  metadata: Record<string, string>;
  /** Prose after the metadata block, up to the first nested subsection. */
  details: string;
  /** Raw body of each nested prose subsection, keyed by its descriptor key. */
  subsections: Record<string, string>;
  /** Which nested prose subsections were actually present in the document. */
  presentSubsections: Set<string>;
  node: MarkdownNode;
};

/**
 * How a section's references participate in renumbering and rewriting.
 *
 * - `renumber`: items are renumbered and prose references to them are rewritten.
 * - `suppress`: references are not rewritten, but text matching the section's aliases
 *   is not reported as an unresolved reference either.
 * - `none`: the section takes no part in reference handling.
 */
export type ReferenceRole = "renumber" | "suppress" | "none";

/** Convert between the stored value and its rendered form (e.g. blockquote markers). */
export type DetailsTransform = {
  decode: (details: string) => string;
  encode: (details: string) => string;
};

/** A `####`-item section whose entries are headings with a body. */
export type HeadingItemsSection = {
  shape: "headingItems";
  /** Field name on the parent model, e.g. `requirements`. */
  key: string;
  /** Exact `### <heading>` text. */
  heading: string;
  /** Singular item label used in item headings, e.g. `Requirement`. */
  singularLabel: string;
  /** Regex alias fragments recognized in prose references, e.g. `reqs?`. */
  aliases: string[];
  referenceRole: ReferenceRole;
  /** Allowed status values, or `null` when the item type carries no status. */
  statuses: readonly string[] | null;
  /** Persistence kind value, or `null` when the section is not stored in `items`. */
  dbKind: string | null;
  required: boolean;
  /** Heading depth of the section itself and of its items. */
  sectionDepth: number;
  itemDepth: number;
  /** Nested prose subsections belonging to each item, e.g. Findings. */
  subsections: ProseSection[];
  /** Metadata fields accepted on an item in a partial document. */
  patchFields: readonly string[];
  detailsTransform?: DetailsTransform;
  /** Model module owning validation, projection, and persistence for one item. */
  model: ItemModel;
};

/** A `###` section whose body is a Markdown bullet list. */
export type BulletListSection = {
  shape: "bulletList";
  key: string;
  heading: string;
  required: boolean;
  sectionDepth: number;
  /** Human-readable name used in bullet parse errors, e.g. `trigger source`. */
  entryLabel: string;
  /** Expected bullet shape shown in parse errors. */
  entrySyntax: string;
  /** Parse one bullet line, or return `undefined` when it is malformed. */
  decodeEntry: (entry: string) => unknown;
  /** Render one stored value back to a bullet line, without the leading `- `. */
  encodeEntry: (value: never) => string;
};

/** A nested prose subsection, e.g. `##### Findings` under a knowledge gap. */
export type ProseSection = {
  shape: "prose";
  key: string;
  heading: string;
  depth: number;
  required: boolean;
  /** Reject a nested `<singularLabel> <ref>` heading inside the prose body. */
  rejectNestedLabel: string;
  /** Statuses that additionally require non-empty prose, e.g. `Resolved`. */
  requiredForStatuses: readonly string[];
};

export type SectionDescriptor = HeadingItemsSection | BulletListSection | ProseSection;

/** Contract every item model module implements. */
export type ItemModel = {
  schema: z.ZodTypeAny;
  /** Project a parsed heading and body into a domain item. */
  fromParsed: (parsed: ParsedItem, section: HeadingItemsSection) => Record<string, unknown>;
  /** Render one domain item, excluding the section heading. */
  format: (item: Record<string, unknown>, section: HeadingItemsSection) => string;
};

/** A top-level document node: the plan itself, a component, or an action item. */
export type NodeDescriptor = {
  key: string;
  /** Human-readable name used in parse errors, e.g. `component`. */
  label: string;
  /** Canonical whole-string reference pattern, shared with the Zod schema. */
  refPattern: RegExp;
  /** Reference prefix every matcher is derived from, e.g. `COMP-`. */
  refPrefix: string;
  /** `<PREFIX>New`, the placeholder an agent uses to create one. */
  placeholderRef: string;
  /** Depth of the node's own heading. */
  headingDepth: number;
  /** `# <heading>` grouping this node type, when it has one. */
  containerHeading: string | null;
  /** Allowed status values, or `null` when the node carries no status. */
  statuses: readonly string[] | null;
  /** Metadata fields accepted on this node in a partial document. */
  patchFields: readonly string[];
  sections: SectionDescriptor[];
};

export function isHeadingItems(section: SectionDescriptor): section is HeadingItemsSection {
  return section.shape === "headingItems";
}

export function isBulletList(section: SectionDescriptor): section is BulletListSection {
  return section.shape === "bulletList";
}

export function isProse(section: SectionDescriptor): section is ProseSection {
  return section.shape === "prose";
}
