/**
 * A Component: the `## **COMP-<n> - <title>**` node owning the six item sections.
 *
 * The section list below is the single declaration of which subsections a component has.
 * Parsing, formatting, patching, and persistence all iterate it; none of them names a
 * section directly.
 */
import { z } from "zod";
import type { HeadingItemsSection, NodeDescriptor, NodeRange, ParseContext } from "./descriptor.js";
import { contentBetween, headingText } from "../shared/ast.js";
import {
  duplicateSubsection,
  invalidNodeHeading,
  missingSubsection,
  unsupportedSubsection,
} from "../shared/errors.js";
import { canonicalRefPattern, placeholderRef, refHeadingPattern } from "../shared/refs.js";
import { formatHeadingItems, parseHeadingItems, sectionIndexes } from "./section.js";
import { decisionSchema, decisionsSection } from "./decision.js";
import { knowledgeGapSchema, knowledgeGapsSection } from "./knowledgeGap.js";
import { textItemSchema, textSection } from "./textItem.js";

const refPrefix = "COMP-";

export const requirementsSection = textSection({
  key: "requirements",
  heading: "Requirements",
  singularLabel: "Requirement",
  aliases: ["requirements?", "reqs?", "r"],
  dbKind: "requirement",
});

export const constraintsSection = textSection({
  key: "constraints",
  heading: "Constraints",
  singularLabel: "Constraint",
  aliases: ["constraints?", "cons?", "c"],
  dbKind: "constraint",
});

export const notesSection = textSection({
  key: "notes",
  heading: "Notes",
  singularLabel: "Note",
  aliases: ["notes?", "n"],
  dbKind: "note",
});

/**
 * Open Questions render their body as a blockquote. That presentation rule lives here as
 * a details transform rather than as a name comparison inside the renderer.
 */
export const questionsSection = textSection({
  key: "questions",
  heading: "Open Questions",
  singularLabel: "Question",
  aliases: ["(?:open\\s+)?questions?", "qs?", "q"],
  dbKind: "question",
  detailsTransform: {
    decode: (details) => details.replace(/^>\s?/, ""),
    encode: (details) => (details ? `> ${details.replace(/^>\s*/, "")}` : details),
  },
});

/** The six component item sections, in canonical document order. */
export const componentItemSections: HeadingItemsSection[] = [
  requirementsSection,
  constraintsSection,
  decisionsSection,
  knowledgeGapsSection,
  notesSection,
  questionsSection,
];

/**
 * Field names below are TypeScript structure, not Markdown vocabulary: the heading text,
 * singular label, aliases, and persistence kind all live in the section descriptors
 * above. `registry-consistency.test.ts` asserts the two stay in agreement.
 */
export const componentSchema = z.object({
  ref: z.string().regex(canonicalRefPattern(refPrefix)),
  title: z.string().min(1),
  description: z.string(),
  requirements: z.array(textItemSchema),
  constraints: z.array(textItemSchema),
  decisions: z.array(decisionSchema),
  knowledgeGaps: z.array(knowledgeGapSchema),
  notes: z.array(textItemSchema),
  questions: z.array(textItemSchema),
});

export type Component = z.infer<typeof componentSchema>;

export const componentDescriptor: NodeDescriptor = {
  key: "component",
  label: "component",
  refPattern: canonicalRefPattern(refPrefix),
  refPrefix,
  placeholderRef: placeholderRef(refPrefix),
  headingDepth: 2,
  headingBold: true,
  containerHeading: "Components",
  statuses: null,
  patchFields: ["Delete", "Replace", "Position", "Handle"],
  sections: componentItemSections,
};


/** Expected component heading shape, shown in parse errors. */
function headingSyntax(allowPlaceholder: boolean): string {
  const number = allowPlaceholder ? "<number|New>" : "<number>";
  return `## **${refPrefix}${number} - <title>**`;
}

/**
 * Parse one component and every section it declares.
 *
 * Section identification comes entirely from `componentDescriptor.sections`; this
 * function never names a section. Item parsing is delegated to the section walker and
 * then projected by each section's own item model.
 */
export function parseComponent(ctx: ParseContext, range: NodeRange): Component {
  const node = ctx.nodes[range.start]!;
  const heading = headingText(node);
  const allowPlaceholder = ctx.mode === "partial";
  const match = heading.match(refHeadingPattern(refPrefix, allowPlaceholder));
  if (!match) throw invalidNodeHeading(node, componentDescriptor.label, heading, headingSyntax(allowPlaceholder));
  const ref = match[1]!;

  const found = new Map<HeadingItemsSection, number>();
  for (const { heading: name, index } of sectionIndexes(ctx.nodes, { start: range.start + 1, end: range.end }, 3)) {
    const section = componentItemSections.find((candidate) => candidate.heading === name);
    if (!section) throw unsupportedSubsection(ctx.nodes[index]!, ref, 3, name);
    if (found.has(section)) throw duplicateSubsection(ctx.nodes[index]!, ref, 3, name);
    found.set(section, index);
  }
  if (ctx.mode === "strict") {
    for (const section of componentItemSections) {
      if (section.required && !found.has(section)) throw missingSubsection(node, ref, 3, section.heading);
    }
  }

  const boundaries = [...found.values()].sort((left, right) => left - right);
  const rangeFor = (section: HeadingItemsSection): NodeRange => {
    const start = found.get(section);
    if (start === undefined) return { start: range.end, end: range.end };
    return { start: start + 1, end: boundaries.find((value) => value > start) ?? range.end };
  };

  const component = {
    ref,
    title: match[2]!.trim(),
    description: contentBetween(ctx.source, ctx.nodes, range.start + 1, 3),
  } as unknown as Record<string, unknown>;
  for (const section of componentItemSections) {
    component[section.key] = parseHeadingItems(ctx, section, rangeFor(section))
      .map((item) => section.model.fromParsed(item, section));
  }
  return component as unknown as Component;
}

/** Render one component and each of its sections, in descriptor order. */
export function formatComponent(component: Component): string {
  const record = component as unknown as Record<string, unknown>;
  const heading = componentDescriptor.headingBold
    ? `## **${component.ref} - ${component.title}**`
    : `## ${component.ref} - ${component.title}`;
  return [
    heading,
    component.description,
    ...componentItemSections.map((section) =>
      formatHeadingItems(section, record[section.key] as Array<Record<string, unknown>>)),
  ].join("\n\n");
}
