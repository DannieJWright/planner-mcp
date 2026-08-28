/**
 * Plan Markdown codec.
 *
 * Parsing and formatting are defined per model under `./models/`: the plan model owns
 * the document, delegates each component and action item to its own model, and each of
 * those delegates its sections to the shared section walker. This module is the public
 * entry point plus reference normalization and the items-only excerpt renderer.
 */
import {
  contentBetween,
  lineLocation,
  nodeText,
  parseLeadingMetadata,
  parseMarkdownNodes,
  type MarkdownNode,
} from "./shared/ast.js";
import { compareItemRefs, referenceKey, subsectionLabel } from "./shared/refs.js";
import { componentItemSections } from "./models/component.js";
import { findingsSection } from "./models/knowledgeGap.js";
import { formatPlanDocument, itemLabels, parsePlanDocument } from "./models/plan.js";
import { acceptanceCriteriaSection } from "./models/actionItem.js";
import { referenceSections, suppressedReferenceSections } from "./models/registry.js";
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

export type OrderingValidationFailure = {
  section: string;
  failure: string;
};

export type PlanValidationFailures = {
  ordering: OrderingValidationFailure[];
};

export type PlanIngestResult = {
  plan: Plan;
  validationFailures: PlanValidationFailures;
};

/** Parse a `#### <Label> <ref> - <title>` heading using the registry's label set. */
export function parseItemHeading(heading: string): { ref: string; title?: string } | undefined {
  return parseItemHeadingWithLabels(heading, itemLabels);
}

/**
 * Renumber every component and item by document order and rewrite the references that
 * appear in prose.
 *
 * The set of reference-bearing sections, their aliases, and which of them merely
 * suppress false reports all come from the descriptor registry.
 */
export function normalizePlan(plan: Plan): PlanIngestResult {
  const mappings = new Map<string, string>();
  const componentNumbers = new Map<string, string>();
  const componentPrefix = "COMP-";

  plan.components.forEach((component, componentIndex) => {
    const componentNumber = componentIndex + 1;
    const oldNumber = component.ref.slice(componentPrefix.length);
    componentNumbers.set(oldNumber, String(componentNumber));
    component.ref = `${componentPrefix}${componentNumber}`;

    for (const section of referenceSections) {
      const items = (component as unknown as Record<string, TextItem[]>)[section.key]!;
      items.forEach((item, itemIndex) => {
        const newRef = `${componentNumber}.${subsectionLabel(itemIndex)}`;
        mappings.set(`${section.key}:${referenceKey(item.ref)}`, newRef);
        item.ref = newRef;
      });
    }
  });

  const componentPattern = /\b(COMP(?:ONENT)?S?)(\s*(?:[-.#]\s*|\s+))(\d+)(?![\w]|\.\d)/gi;
  const typedPatterns = referenceSections.map((section) => ({
    key: section.key,
    label: section.singularLabel,
    aliases: section.aliases,
    pattern: new RegExp(`\\b(${section.aliases.join("|")})(\\s+|\\.\\s*)(\\d+(?:\\.[A-Za-z]+)+)`, "gi"),
  }));
  const suppressedPatterns = suppressedReferenceSections.map(
    (section) => new RegExp(`(?:${section.aliases.join("|")})\\s+\\d+(?:\\.[A-Za-z]+)+$`, "i"),
  );
  const genericPattern = /\b([A-Za-z][A-Za-z.]*)(\s+)(\d+(?:\.[A-Za-z]+)+)/g;
  const failures: OrderingValidationFailure[] = [];

  const rewrite = (value: string, section: string): string => {
    const unresolved: Array<{ start: number; end: number; failure: string }> = [];
    let rewritten = value.replace(componentPattern, (match, label: string, separator: string, number: string, offset: number) => {
      const replacement = componentNumbers.get(number);
      if (replacement) return `${label}${separator}${replacement}`;
      unresolved.push({ start: offset, end: offset + match.length, failure: match });
      return match;
    });

    for (const type of typedPatterns) {
      rewritten = rewritten.replace(type.pattern, (match, alias: string, separator: string, ref: string, offset: number) => {
        const replacement = mappings.get(`${type.key}:${referenceKey(ref)}`);
        if (replacement) return `${alias}${separator}${replacement}`;
        unresolved.push({ start: offset, end: offset + match.length, failure: match });
        return match;
      });
    }

    for (const match of rewritten.matchAll(genericPattern)) {
      const failure = match[0];
      if (!failure) continue;
      const context = rewritten.slice(Math.max(0, match.index - 40), match.index + failure.length);
      const isKnownSuffix = typedPatterns.some((type) => new RegExp(`(?:${type.aliases.join("|")})(?:\\s+|\\.\\s*)\\d+(?:\\.[A-Za-z]+)+$`, "i").test(context))
        || suppressedPatterns.some((pattern) => pattern.test(context));
      if (isKnownSuffix) continue;
      unresolved.push({ start: match.index, end: match.index + failure.length, failure });
    }
    unresolved.sort((left, right) => left.start - right.start);
    for (const failure of unresolved) failures.push({ section, failure: failure.failure });
    return rewritten;
  };

  plan.title = rewrite(plan.title, "Plan");
  plan.description = rewrite(plan.description, "Plan");
  plan.tags = plan.tags.map((tag) => rewrite(tag, "Plan"));
  for (const component of plan.components) {
    component.title = rewrite(component.title, component.ref);
    component.description = rewrite(component.description, component.ref);
    for (const section of referenceSections) {
      for (const item of (component as unknown as Record<string, TextItem[]>)[section.key]!) {
        const context = `${section.singularLabel} ${item.ref}`;
        item.title = rewrite(item.title, context);
        item.details = rewrite(item.details, context);
        const record = item as unknown as Record<string, string>;
        if (findingsSection.key in record) {
          record[findingsSection.key] = rewrite(record[findingsSection.key]!, context);
        }
      }
    }
  }
  for (const action of plan.actionItems) {
    action.title = rewrite(action.title, action.ref);
    action.context = rewrite(action.context, action.ref);
    for (const criterion of action.acceptanceCriteria) {
      const context = `${acceptanceCriteriaSection.singularLabel} ${criterion.ref}`;
      criterion.title = rewrite(criterion.title, context);
      criterion.details = rewrite(criterion.details, context);
    }
    for (const source of action.triggerSources) {
      source.ref = rewrite(source.ref, action.ref);
      source.title = rewrite(source.title, action.ref);
    }
    action.assignees = action.assignees.map((assignee) => rewrite(assignee, action.ref));
  }

  return { plan, validationFailures: { ordering: failures } };
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
