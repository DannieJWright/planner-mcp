/**
 * Plan Markdown codec entry point.
 *
 * All parsing, formatting, and normalization is defined per model under `./models/`:
 * the plan model owns the document, delegates each component and action item to its own
 * model, and those delegate their sections to the shared section walker. This module
 * only exposes the public entry points, the items-only excerpt renderer, and
 * compatibility projections for callers that predate the registry.
 */
import {
  contentBetween,
  lineLocation,
  nodeText,
  parseLeadingMetadata,
  parseMarkdownNodes,
  type MarkdownNode,
} from "./shared/ast.js";
import { compareItemRefs, subsectionLabel } from "./shared/refs.js";
import { componentItemSections } from "./models/component.js";
import { findingsSection } from "./models/knowledgeGap.js";
import { formatPlanDocument, itemLabels, parsePlanDocument } from "./models/plan.js";
import { normalizePlan, type OrderingValidationFailure, type PlanIngestResult, type PlanValidationFailures } from "./models/normalize.js";
import { itemHeadingPattern, parseItemHeading as parseItemHeadingWithLabels } from "./models/section.js";
import type { Plan, StatusItem, TextItem, KnowledgeGap } from "./domain.js";

export { contentBetween, lineLocation, nodeText, parseLeadingMetadata, parseMarkdownNodes, type MarkdownNode };
export { compareItemRefs, subsectionLabel };

export type ComponentItemKey = "requirements" | "constraints" | "decisions" | "knowledgeGaps" | "notes" | "questions";

/**
 * Section heading, canonical item label, and model key for each component item
 * collection, projected from the descriptor registry for callers that predate it.
 */
export const componentSections: Array<{
  key: ComponentItemKey;
  label: string;
  section: string;
}> = componentItemSections.map((section) => ({
  key: section.key as ComponentItemKey,
  label: section.singularLabel,
  section: section.heading,
}));

export { normalizePlan };
export type { OrderingValidationFailure, PlanIngestResult, PlanValidationFailures };

/** Parse a `#### <Label> <ref> - <title>` heading using the registry's label set. */
export function parseItemHeading(heading: string): { ref: string; title?: string } | undefined {
  return parseItemHeadingWithLabels(heading, itemLabels);
}

/** Parse, validate, and normalize a complete plan document. */
export function ingestPlanMarkdown(markdown: string): PlanIngestResult {
  return normalizePlan(parsePlanDocument(markdown));
}

export function parsePlanMarkdown(markdown: string): Plan {
  return ingestPlanMarkdown(markdown).plan;
}

/** Render a complete canonical plan document. */
export function formatPlanMarkdown(planInput: Plan): string {
  return formatPlanDocument(planInput);
}

export type ItemExcerptGroup = {
  ref: string;
  title: string;
  items: Array<TextItem | StatusItem | KnowledgeGap>;
};

/**
 * Render an items-only Markdown excerpt: plan and component context as headings plus the
 * matching items using the same heading conventions as `formatPlanMarkdown`.
 * This is deliberately not a full plan document and is not re-ingestible.
 */
export function formatItemsExcerptMarkdown(
  plan: Pick<Plan, "reference" | "title">,
  groups: ItemExcerptGroup[],
  label: string,
): string {
  const findingsHeading = `${"#".repeat(findingsSection.depth)} ${findingsSection.heading}`;
  const body = groups.map((group) => {
    const items = group.items.map((item) => {
      const heading = `#### ${label} ${item.ref}${item.title !== `${label} ${item.ref}` ? ` - ${item.title}` : ""}`;
      const status = "status" in item ? `\n\n**Status:** ${item.status}` : "";
      const details = item.details ? `\n\n${item.details}` : "";
      const findings = findingsSection.key in item
        ? `\n\n${findingsHeading}\n\n${(item as KnowledgeGap).findings}`.trimEnd()
        : "";
      return `${heading}${status}${details}${findings}`.trimEnd();
    }).join("\n\n");
    return `## ${group.ref} - ${group.title}\n\n${items}`.trimEnd();
  }).join("\n\n");
  return `# ${plan.reference} - ${plan.title}${body ? `\n\n${body}` : ""}\n`;
}

export { itemHeadingPattern };
