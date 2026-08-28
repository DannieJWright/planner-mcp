/**
 * A Component: the `## **COMP-<n> - <title>**` node owning the six item sections.
 *
 * The section list below is the single declaration of which subsections a component has.
 * Parsing, formatting, patching, and persistence all iterate it; none of them names a
 * section directly.
 */
import { z } from "zod";
import type { HeadingItemsSection, NodeDescriptor } from "./descriptor.js";
import { canonicalRefPattern, placeholderRef } from "../shared/refs.js";
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
  containerHeading: "Components",
  statuses: null,
  patchFields: ["Delete", "Replace", "Position", "Handle"],
  sections: componentItemSections,
};
