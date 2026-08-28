/**
 * Reference normalization.
 *
 * After a document is parsed or a patch is merged, every component and item reference is
 * reassigned strictly by array index, and the references appearing in prose are rewritten
 * to match. References that cannot be resolved are left untouched and reported.
 *
 * Which sections take part, and under which aliases they may be written in prose, comes
 * entirely from the descriptor registry.
 */
import { referenceKey, subsectionLabel } from "../shared/refs.js";
import { acceptanceCriteriaSection } from "./actionItem.js";
import { componentDescriptor } from "./component.js";
import { findingsSection } from "./knowledgeGap.js";
import type { Plan } from "./plan.js";
import { referenceSections, suppressedReferenceSections } from "./registry.js";

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

type Indexed = { ref: string; title: string; details: string };

/**
 * Matches a component reference written in prose.
 *
 * The spelled-out `COMPONENT`/`COMPONENTS` forms are accepted here because plans have
 * always been able to write them in prose. This is prose recognition, not heading
 * validation: heading matchers are derived from the canonical prefix in `shared/refs.ts`
 * and remain strict.
 */
const componentProsePattern = /\b(COMP(?:ONENT)?S?)(\s*(?:[-.#]\s*|\s+))(\d+)(?![\w]|\.\d)/gi;

/** Matches anything shaped like `<word> <number>.<letters>` for unresolved reporting. */
const genericPattern = /\b([A-Za-z][A-Za-z.]*)(\s+)(\d+(?:\.[A-Za-z]+)+)/g;

function aliasGroup(aliases: string[]): string {
  return aliases.join("|");
}

export function normalizePlan(plan: Plan): PlanIngestResult {
  const mappings = new Map<string, string>();
  const componentNumbers = new Map<string, string>();
  const { refPrefix } = componentDescriptor;

  plan.components.forEach((component, componentIndex) => {
    const componentNumber = componentIndex + 1;
    componentNumbers.set(component.ref.slice(refPrefix.length), String(componentNumber));
    component.ref = `${refPrefix}${componentNumber}`;

    for (const section of referenceSections) {
      const items = (component as unknown as Record<string, Indexed[]>)[section.key]!;
      items.forEach((item, itemIndex) => {
        const newRef = `${componentNumber}.${subsectionLabel(itemIndex)}`;
        mappings.set(`${section.key}:${referenceKey(item.ref)}`, newRef);
        item.ref = newRef;
      });
    }
  });

  const typedPatterns = referenceSections.map((section) => ({
    key: section.key,
    aliases: section.aliases,
    pattern: new RegExp(`\\b(${aliasGroup(section.aliases)})(\\s+|\\.\\s*)(\\d+(?:\\.[A-Za-z]+)+)`, "gi"),
    suffix: new RegExp(`(?:${aliasGroup(section.aliases)})(?:\\s+|\\.\\s*)\\d+(?:\\.[A-Za-z]+)+$`, "i"),
  }));
  const suppressedSuffixes = suppressedReferenceSections.map(
    (section) => new RegExp(`(?:${aliasGroup(section.aliases)})\\s+\\d+(?:\\.[A-Za-z]+)+$`, "i"),
  );
  const failures: OrderingValidationFailure[] = [];

  const rewrite = (value: string, context: string): string => {
    const unresolved: Array<{ start: number; failure: string }> = [];

    let rewritten = value.replace(componentProsePattern, (match, label: string, separator: string, number: string, offset: number) => {
      const replacement = componentNumbers.get(number);
      if (replacement) return `${label}${separator}${replacement}`;
      unresolved.push({ start: offset, failure: match });
      return match;
    });

    for (const type of typedPatterns) {
      rewritten = rewritten.replace(type.pattern, (match, alias: string, separator: string, ref: string, offset: number) => {
        const replacement = mappings.get(`${type.key}:${referenceKey(ref)}`);
        if (replacement) return `${alias}${separator}${replacement}`;
        unresolved.push({ start: offset, failure: match });
        return match;
      });
    }

    for (const match of rewritten.matchAll(genericPattern)) {
      const failure = match[0];
      if (!failure) continue;
      const preceding = rewritten.slice(Math.max(0, match.index - 40), match.index + failure.length);
      const recognized = typedPatterns.some((type) => type.suffix.test(preceding))
        || suppressedSuffixes.some((pattern) => pattern.test(preceding));
      if (recognized) continue;
      unresolved.push({ start: match.index, failure });
    }

    unresolved.sort((left, right) => left.start - right.start);
    for (const entry of unresolved) failures.push({ section: context, failure: entry.failure });
    return rewritten;
  };

  plan.title = rewrite(plan.title, "Plan");
  plan.description = rewrite(plan.description, "Plan");
  plan.tags = plan.tags.map((tag) => rewrite(tag, "Plan"));

  for (const component of plan.components) {
    component.title = rewrite(component.title, component.ref);
    component.description = rewrite(component.description, component.ref);
    for (const section of referenceSections) {
      for (const item of (component as unknown as Record<string, Indexed[]>)[section.key]!) {
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
