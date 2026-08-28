import matter from "gray-matter";
import { planStatuses, type ActionItem, type Component, type Plan, type TextItem } from "./domain.js";
import { normalizePlan, type PlanIngestResult } from "./models/normalize.js";
import { acceptanceCriteriaSection, actionItemDescriptor, actionItemSections } from "./models/actionItem.js";
import { componentDescriptor, componentItemSections, type ComponentItemKey } from "./models/component.js";
import { isBulletList, isHeadingItems, type HeadingItemsSection, type NodeRange, type ParseContext, type ParsedItem } from "./models/descriptor.js";
import { createParseContext, planCollections, planPatchableFields } from "./models/plan.js";
import { locateSections, parseBulletList, parseHeadingItems, resolveStatus } from "./models/section.js";
import {
  contentBetween,
  headingText,
  nextBoundary,
  parseLeadingMetadata,
  type LeadingMetadata,
  type MarkdownNode,
} from "./shared/ast.js";
import {
  invalidBoolean,
  invalidFrontmatterStatus,
  invalidMetadataStatus,
  invalidNodeHeading,
  invalidPosition,
  missingPersistedReference,
  unsupportedBlockHeading,
  unsupportedStatusField,
} from "./shared/errors.js";
import {
  canonicalizeRef,
  newNodePlaceholder,
  refHeadingPattern,
  refHeadingPrefix,
  refNumber,
  subsectionLabel,
} from "./shared/refs.js";

/* -------------------------------------------------------------------------- */
/* Patch model                                                                */
/* -------------------------------------------------------------------------- */

export const newComponentRef = componentDescriptor.placeholderRef;
export const newActionItemRef = actionItemDescriptor.placeholderRef;
export const newItemRef = newNodePlaceholder;

export type ItemPatchValue = {
  title?: string;
  details?: string;
  status?: string;
  findings?: string;
};

export type ItemPatch = {
  kind: ComponentItemKey;
  ref: string;
  handle?: string;
  delete: boolean;
  value: ItemPatchValue;
};

export type ComponentPatch = {
  ref: string;
  handle?: string;
  delete: boolean;
  replaceChildren: boolean;
  position?: number;
  title?: string;
  description?: string;
  items: ItemPatch[];
};

export type ActionItemPatch = {
  ref: string;
  handle?: string;
  delete: boolean;
  position?: number;
  title?: string;
  status?: ActionItem["status"];
  context?: string;
  acceptanceCriteria?: Array<{ ref: string; title?: string; details?: string; delete: boolean; handle?: string }>;
  triggerSources?: ActionItem["triggerSources"];
  assignees?: string[];
};

export type PlanPatch = {
  reference: string;
  meta: Partial<Pick<Plan, "title" | "description" | "tags" | "status">>;
  components: ComponentPatch[];
  actionItems: ActionItemPatch[];
};

/* -------------------------------------------------------------------------- */
/* Provenance & reference diffing                                             */
/* -------------------------------------------------------------------------- */

export type NodeProvenance = {
  /** Reference this node carried in the persisted plan, or null when newly created. */
  originRef: string | null;
  /** Agent-supplied correlation token for a node created from a `New` placeholder. */
  handle?: string;
  title: string;
};

export type ComponentProvenance = NodeProvenance & {
  items: Record<ComponentItemKey, NodeProvenance[]>;
};

export type PlanProvenance = {
  components: ComponentProvenance[];
  actionItems: NodeProvenance[];
};

export type ReferenceKind = "component" | "actionItem" | ComponentItemKey;

export type ReferenceChange =
  | { change: "renamed"; kind: ReferenceKind; from: string; to: string }
  | { change: "added"; kind: ReferenceKind; to: string; handle?: string; title: string; parent?: string }
  | { change: "removed"; kind: ReferenceKind; from: string };

export type ReferenceChanges = {
  /** True when any reference the caller may already hold was renamed or removed. */
  shifted: boolean;
  changes: ReferenceChange[];
};

export const emptyReferenceChanges: ReferenceChanges = { shifted: false, changes: [] };

/** Provenance for a plan whose nodes all keep their persisted references (no adds). */
export function identityProvenance(plan: Plan): PlanProvenance {
  return {
    components: plan.components.map((component) => ({
      originRef: component.ref,
      title: component.title,
      items: Object.fromEntries(componentItemSections.map(({ key }) => [
        key,
        component[key].map((item) => ({ originRef: item.ref, title: item.title })),
      ])) as Record<ComponentItemKey, NodeProvenance[]>,
    })),
    actionItems: plan.actionItems.map((action) => ({ originRef: action.ref, title: action.title })),
  };
}

/**
 * Compare the persisted plan against the post-patch, post-normalization plan and report
 * which references were renamed, removed, or newly assigned.
 *
 * This assumes all node movement happens in the patch engine and that `normalizePlan()`
 * assigns references strictly by array index, so `provenance` stays index-aligned with
 * `normalized`.
 */
export function diffReferences(original: Plan, normalized: Plan, provenance: PlanProvenance): ReferenceChanges {
  const originalRefs = new Set<string>();
  for (const component of original.components) {
    originalRefs.add(`component:${component.ref}`);
    for (const { key } of componentItemSections) {
      for (const item of component[key]) originalRefs.add(`${key}:${item.ref}`);
    }
  }
  for (const action of original.actionItems) originalRefs.add(`actionItem:${action.ref}`);

  const changes: ReferenceChange[] = [];
  const seen = new Set<string>();

  const visit = (kind: ReferenceKind, finalRef: string, node: NodeProvenance, parent?: string): void => {
    const key = node.originRef === null ? null : `${kind}:${node.originRef}`;
    if (key !== null && originalRefs.has(key)) {
      seen.add(key);
      if (node.originRef !== finalRef) changes.push({ change: "renamed", kind, from: node.originRef!, to: finalRef });
      return;
    }
    const added: ReferenceChange = { change: "added", kind, to: finalRef, title: node.title };
    if (node.handle !== undefined) added.handle = node.handle;
    if (parent !== undefined) added.parent = parent;
    changes.push(added);
  };

  normalized.components.forEach((component, index) => {
    const componentProvenance = provenance.components[index];
    if (!componentProvenance) throw new Error("Provenance is not aligned with the normalized plan components");
    visit("component", component.ref, componentProvenance);
    for (const { key } of componentItemSections) {
      component[key].forEach((item, itemIndex) => {
        const itemProvenance = componentProvenance.items[key][itemIndex];
        if (!itemProvenance) throw new Error(`Provenance is not aligned with ${component.ref} ${key}`);
        visit(key, item.ref, itemProvenance, component.ref);
      });
    }
  });
  normalized.actionItems.forEach((action, index) => {
    const actionProvenance = provenance.actionItems[index];
    if (!actionProvenance) throw new Error("Provenance is not aligned with the normalized plan action items");
    visit("actionItem", action.ref, actionProvenance);
  });

  for (const key of originalRefs) {
    if (seen.has(key)) continue;
    const separator = key.indexOf(":");
    changes.push({ change: "removed", kind: key.slice(0, separator) as ReferenceKind, from: key.slice(separator + 1) });
  }

  return { shifted: changes.some((change) => change.change !== "added"), changes };
}

/* -------------------------------------------------------------------------- */
/* Partial Markdown parsing                                                   */
/* -------------------------------------------------------------------------- */

function parseBoolean(value: string, field: string, context: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  throw invalidBoolean(context, field, value);
}

function parsePosition(value: string, context: string): number {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) throw invalidPosition(context, value);
  return parsed;
}

/**
 * Read the metadata block and description that precede a node's first `###` subsection.
 *
 * The allowed field names come from the node descriptor, so a node type's patch
 * vocabulary is declared in exactly one place.
 */
function readNodePreamble(
  ctx: ParseContext,
  range: NodeRange,
  fields: readonly string[],
  context: string,
): LeadingMetadata {
  const boundary = nextBoundary(ctx.nodes, range.start + 1, range.end, 3);
  const body = contentBetween(ctx.source, ctx.nodes.slice(0, boundary), range.start + 1, 3);
  return parseLeadingMetadata(body, fields, context);
}

/**
 * Project a parsed item into a patch operation.
 *
 * The traversal itself is the same one the strict parser uses; only this projection
 * differs, because a partial document describes a change rather than a complete item.
 */
function toItemPatch(parsed: ParsedItem, section: HeadingItemsSection): ItemPatch {
  const context = `${section.singularLabel} ${parsed.ref}`;
  const value: ItemPatchValue = {};
  if (parsed.title !== undefined) value.title = parsed.title;
  if (parsed.details) {
    value.details = section.detailsTransform ? section.detailsTransform.decode(parsed.details) : parsed.details;
  }
  if (parsed.metadata.Status !== undefined) {
    if (section.statuses === null) throw unsupportedStatusField(parsed.node, context);
    const status = resolveStatus(section.statuses, parsed.metadata.Status);
    if (!status) throw invalidMetadataStatus(parsed.node, context, parsed.metadata.Status, section.statuses);
    value.status = status;
  }
  for (const subsection of section.subsections) {
    if (!parsed.presentSubsections.has(subsection.key)) continue;
    (value as Record<string, unknown>)[subsection.key] = parsed.subsections[subsection.key];
  }

  const patch: ItemPatch = {
    kind: section.key as ComponentItemKey,
    ref: parsed.ref,
    delete: parsed.metadata.Delete === undefined ? false : parseBoolean(parsed.metadata.Delete, "Delete", context),
    value,
  };
  if (parsed.metadata.Handle !== undefined) patch.handle = parsed.metadata.Handle;
  return patch;
}

function parsePartialComponent(ctx: ParseContext, range: NodeRange): ComponentPatch {
  const node = ctx.nodes[range.start]!;
  const heading = headingText(node);
  const match = heading.match(refHeadingPattern(componentDescriptor.refPrefix, true));
  if (!match) {
    throw invalidNodeHeading(node, componentDescriptor.label, heading, `## **${componentDescriptor.refPrefix}<number|New> - <title>**`);
  }
  const ref = canonicalizeRef(match[1]!, componentDescriptor.refPrefix);

  const found = locateSections(ctx, ref, componentItemSections, range, 3);
  const ordered = [...found.entries()].sort((left, right) => left[1].start - right[1].start);
  const items = ordered.flatMap(([section, sectionRange]) =>
    parseHeadingItems(ctx, section, sectionRange).map((item) => toItemPatch(item, section)));

  const preamble = readNodePreamble(ctx, range, componentDescriptor.patchFields, ref);
  const patch: ComponentPatch = {
    ref,
    delete: preamble.fields.Delete === undefined ? false : parseBoolean(preamble.fields.Delete, "Delete", ref),
    replaceChildren: preamble.fields.Replace === undefined ? false : parseBoolean(preamble.fields.Replace, "Replace", ref),
    title: match[2]!.trim(),
    items,
  };
  if (preamble.rest) patch.description = preamble.rest;
  if (preamble.fields.Position !== undefined) patch.position = parsePosition(preamble.fields.Position, ref);
  if (preamble.fields.Handle !== undefined) patch.handle = preamble.fields.Handle;
  return patch;
}

function parsePartialActionItem(ctx: ParseContext, range: NodeRange): ActionItemPatch {
  const node = ctx.nodes[range.start]!;
  const heading = headingText(node);
  const match = heading.match(refHeadingPattern(actionItemDescriptor.refPrefix, true));
  if (!match) {
    throw invalidNodeHeading(node, actionItemDescriptor.label, heading, `## **${actionItemDescriptor.refPrefix}<number|New> - <title>**`);
  }
  const ref = canonicalizeRef(match[1]!, actionItemDescriptor.refPrefix);

  const found = locateSections(ctx, ref, actionItemSections, range, 3);
  const preamble = readNodePreamble(ctx, range, actionItemDescriptor.patchFields, ref);

  const patch: ActionItemPatch = {
    ref,
    delete: preamble.fields.Delete === undefined ? false : parseBoolean(preamble.fields.Delete, "Delete", ref),
    title: match[2]!.trim(),
  };
  if (preamble.rest) patch.context = preamble.rest;
  if (preamble.fields.Position !== undefined) patch.position = parsePosition(preamble.fields.Position, ref);
  if (preamble.fields.Handle !== undefined) patch.handle = preamble.fields.Handle;
  if (preamble.fields.Status !== undefined) {
    const status = resolveStatus(actionItemDescriptor.statuses!, preamble.fields.Status);
    if (!status) throw invalidMetadataStatus(node, ref, preamble.fields.Status, actionItemDescriptor.statuses!);
    patch.status = status as ActionItem["status"];
  }

  for (const [section, sectionRange] of found) {
    if (isHeadingItems(section)) {
      patch.acceptanceCriteria = parseHeadingItems(ctx, section, sectionRange)
        .map((item) => toItemPatch(item, section))
        .map((item) => {
          const criterion: NonNullable<ActionItemPatch["acceptanceCriteria"]>[number] = { ref: item.ref, delete: item.delete };
          if (item.value.title !== undefined) criterion.title = item.value.title;
          if (item.value.details !== undefined) criterion.details = item.value.details;
          if (item.handle !== undefined) criterion.handle = item.handle;
          return criterion;
        });
      continue;
    }
    if (!isBulletList(section)) continue;
    const values = parseBulletList(ctx, section, sectionRange);
    if (section.key === "triggerSources") patch.triggerSources = values as ActionItem["triggerSources"];
    else patch.assignees = values as string[];
  }
  return patch;
}

/**
 * Parse a partial plan document: a Markdown plan document that may omit anything that is
 * not being changed. Root headings and subsections are optional, references may be `New`
 * placeholders, and nodes may carry `Delete`/`Replace`/`Position`/`Handle` metadata.
 */
export function parsePlanPatchMarkdown(markdown: string): PlanPatch {
  const parsed = matter(markdown);
  const reference = parsed.data.reference === undefined ? "" : String(parsed.data.reference).trim();
  if (!reference || reference.toLowerCase() === newNodePlaceholder.toLowerCase()) throw missingPersistedReference();

  const ctx = createParseContext(parsed.content, "partial");
  const blockStarts = ctx.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.type === "heading" && (node.depth === 1 || node.depth === 2))
    .map(({ index }) => index);

  const components: ComponentPatch[] = [];
  const actionItems: ActionItemPatch[] = [];
  blockStarts.forEach((start, order) => {
    const node = ctx.nodes[start]!;
    if (node.depth === 1) return;
    const range: NodeRange = { start, end: blockStarts[order + 1] ?? ctx.nodes.length };
    const heading = headingText(node);
    if (refHeadingPrefix(componentDescriptor.refPrefix, true).test(heading)) {
      components.push(parsePartialComponent(ctx, range));
      return;
    }
    if (refHeadingPrefix(actionItemDescriptor.refPrefix, true).test(heading)) {
      actionItems.push(parsePartialActionItem(ctx, range));
      return;
    }
    throw unsupportedBlockHeading(node, heading, planCollections.map(
      ({ node: descriptor }) => `${descriptor.refPrefix}<number|New> - <title>`,
    ));
  });

  const meta: PlanPatch["meta"] = {};
  for (const field of planPatchableFields) {
    const value = parsed.data[field];
    if (value === undefined) continue;
    if (field === "tags") {
      meta.tags = (value as unknown[]).map((tag) => String(tag));
      continue;
    }
    if (field === "status") {
      const status = resolveStatus(planStatuses, String(value));
      if (!status) throw invalidFrontmatterStatus(String(value), planStatuses);
      meta.status = status as Plan["status"];
      continue;
    }
    meta[field] = String(value);
  }

  return { reference, meta, components, actionItems };
}

/* -------------------------------------------------------------------------- */
/* Merge engine                                                               */
/* -------------------------------------------------------------------------- */

type ItemNode = TextItem & { status?: string } & Record<string, unknown>;

type TrackedItem = {
  node: ItemNode;
  provenance: NodeProvenance;
  placeholderTitle: boolean;
};

function emptyItemBuckets(): Record<ComponentItemKey, TrackedItem[]> {
  return Object.fromEntries(componentItemSections.map(({ key }) => [key, [] as TrackedItem[]])) as Record<ComponentItemKey, TrackedItem[]>;
}

type WorkingComponent = {
  ref: string;
  title: string;
  description: string;
  items: Record<ComponentItemKey, TrackedItem[]>;
  provenance: NodeProvenance;
};

type WorkingAction = {
  node: ActionItem;
  provenance: NodeProvenance;
};

function toWorkingComponent(component: Component): WorkingComponent {
  return {
    ref: component.ref,
    title: component.title,
    description: component.description,
    items: Object.fromEntries(componentItemSections.map(({ key }) => [
      key,
      component[key].map((item): TrackedItem => ({
        node: { ...item },
        provenance: { originRef: item.ref, title: item.title },
        placeholderTitle: false,
      })),
    ])) as Record<ComponentItemKey, TrackedItem[]>,
    provenance: { originRef: component.ref, title: component.title },
  };
}

function sectionFor(kind: ComponentItemKey): HeadingItemsSection<ComponentItemKey> {
  return componentItemSections.find((entry) => entry.key === kind)!;
}

function applyItemValue(node: ItemNode, value: ItemPatchValue, section: HeadingItemsSection): void {
  if (value.title !== undefined) node.title = value.title;
  if (value.details !== undefined) node.details = value.details;
  if (value.status !== undefined) node.status = value.status;
  const supplied = value as unknown as Record<string, unknown>;
  for (const subsection of section.subsections) {
    if (supplied[subsection.key] !== undefined) node[subsection.key] = supplied[subsection.key];
  }
}

/**
 * Build a new item from a patch, filling in the defaults its descriptor declares: the
 * first allowed status, and an empty body for each nested subsection.
 */
function createItem(patch: ItemPatch): TrackedItem {
  const section = sectionFor(patch.kind);
  const node: ItemNode = {
    ref: newItemRef,
    title: patch.value.title ?? `${section.singularLabel} ${newItemRef}`,
    details: patch.value.details ?? "",
  };
  if (section.statuses !== null) node.status = patch.value.status ?? section.statuses[0]!;
  const supplied = patch.value as unknown as Record<string, unknown>;
  for (const subsection of section.subsections) {
    node[subsection.key] = supplied[subsection.key] ?? "";
  }
  const provenance: NodeProvenance = { originRef: null, title: node.title };
  if (patch.handle !== undefined) provenance.handle = patch.handle;
  return { node, provenance, placeholderTitle: patch.value.title === undefined };
}

function applyItemPatches(component: WorkingComponent, patches: ItemPatch[], replaceChildren: boolean): void {
  if (replaceChildren) {
    const snapshot = component.items;
    component.items = emptyItemBuckets();
    for (const patch of patches) {
      if (patch.delete) continue;
      const existing = snapshot[patch.kind].find((tracked) => tracked.node.ref === patch.ref);
      if (patch.ref !== newItemRef && existing) {
        applyItemValue(existing.node, patch.value, sectionFor(patch.kind));
        existing.provenance.title = existing.node.title;
        component.items[patch.kind].push(existing);
      } else {
        component.items[patch.kind].push(createItem(patch));
      }
    }
    return;
  }

  for (const patch of patches) {
    const list = component.items[patch.kind];
    const index = patch.ref === newItemRef ? -1 : list.findIndex((tracked) => tracked.node.ref === patch.ref);
    if (index === -1) {
      // Requirement 1.E: an unknown target reference is upserted as a new node.
      if (patch.delete) continue;
      list.push(createItem(patch));
      continue;
    }
    if (patch.delete) {
      list.splice(index, 1);
      continue;
    }
    const tracked = list[index]!;
    applyItemValue(tracked.node, patch.value, sectionFor(patch.kind));
    tracked.provenance.title = tracked.node.title;
  }
}

function createComponent(patch: ComponentPatch): WorkingComponent {
  const provenance: NodeProvenance = { originRef: null, title: patch.title ?? "" };
  if (patch.handle !== undefined) provenance.handle = patch.handle;
  const component: WorkingComponent = {
    ref: newComponentRef,
    title: patch.title ?? "",
    description: patch.description ?? "",
    items: emptyItemBuckets(),
    provenance,
  };
  applyItemPatches(component, patch.items, false);
  return component;
}

/**
 * Reorder `entries` so that every entry carrying an explicit 1-based position lands as close
 * to that position as possible. Conflicts resolve gracefully (Decision 1.F): positions apply
 * in ascending order, ties break by patch-document order, out-of-range values clamp to the
 * bounds of the list, and unpositioned entries keep their relative order in the free slots.
 */
function applyPositions<T>(entries: T[], positioned: Array<{ entry: T; position: number; order: number }>): T[] {
  const requests = positioned
    .filter(({ entry }) => entries.includes(entry))
    .sort((left, right) => left.position - right.position || left.order - right.order);
  if (requests.length === 0) return entries;

  const total = entries.length;
  const slots = new Array<T | undefined>(total);
  for (const request of requests) {
    const clamped = Math.min(Math.max(Math.trunc(request.position), 1), total) - 1;
    let index = clamped;
    while (index < total && slots[index] !== undefined) index += 1;
    if (index >= total) {
      index = clamped;
      while (index >= 0 && slots[index] !== undefined) index -= 1;
    }
    if (index >= 0 && index < total) slots[index] = request.entry;
  }
  const placed = new Set(requests.map(({ entry }) => entry));
  let cursor = 0;
  for (const entry of entries) {
    if (placed.has(entry)) continue;
    while (cursor < total && slots[cursor] !== undefined) cursor += 1;
    if (cursor < total) slots[cursor] = entry;
  }
  return slots.filter((entry): entry is T => entry !== undefined);
}

function nextActionRef(actions: WorkingAction[]): string {
  const { refPrefix } = actionItemDescriptor;
  const numbers = actions
    .map((action) => refNumber(action.node.ref, refPrefix))
    .filter((value): value is number => value !== undefined);
  return `${refPrefix}${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
}

function applyActionPatch(action: WorkingAction, patch: ActionItemPatch): void {
  if (patch.title !== undefined) action.node.title = patch.title;
  if (patch.status !== undefined) action.node.status = patch.status;
  if (patch.context !== undefined) action.node.context = patch.context;
  if (patch.triggerSources !== undefined) action.node.triggerSources = patch.triggerSources;
  if (patch.assignees !== undefined) action.node.assignees = patch.assignees;
  if (patch.acceptanceCriteria !== undefined) {
    for (const criterion of patch.acceptanceCriteria) {
      const index = criterion.ref === newItemRef ? -1 : action.node.acceptanceCriteria.findIndex((entry) => entry.ref === criterion.ref);
      if (index === -1) {
        if (criterion.delete) continue;
        const used = new Set(action.node.acceptanceCriteria.map((entry) => entry.ref));
        let label = 0;
        while (used.has(subsectionLabel(label))) label += 1;
        const ref = subsectionLabel(label);
        action.node.acceptanceCriteria.push({ ref, title: criterion.title ?? `${acceptanceCriteriaSection.singularLabel} ${ref}`, details: criterion.details ?? "" });
        continue;
      }
      if (criterion.delete) {
        action.node.acceptanceCriteria.splice(index, 1);
        continue;
      }
      const entry = action.node.acceptanceCriteria[index]!;
      if (criterion.title !== undefined) entry.title = criterion.title;
      if (criterion.details !== undefined) entry.details = criterion.details;
    }
  }
  action.provenance.title = action.node.title;
}

export type PlanPatchResult = PlanIngestResult & { provenance: PlanProvenance };

/**
 * Merge a partial document into a persisted plan and renumber the result.
 *
 * Order of evaluation (Requirement 1.F/1.I/1.J): merge, add, and delete first; component and
 * action-item reordering last; then `normalizePlan()` renumbers every reference by array
 * index and rewrites cross-references in prose.
 */
export function applyPlanPatch(existing: Plan, patch: PlanPatch): PlanPatchResult {
  const plan: Plan = structuredClone(existing);
  if (patch.meta.title !== undefined) plan.title = patch.meta.title;
  if (patch.meta.description !== undefined) plan.description = patch.meta.description;
  if (patch.meta.tags !== undefined) plan.tags = patch.meta.tags;
  if (patch.meta.status !== undefined) plan.status = patch.meta.status;

  const components = plan.components.map(toWorkingComponent);
  const componentPositions: Array<{ entry: WorkingComponent; position: number; order: number }> = [];

  patch.components.forEach((componentPatch, order) => {
    const index = componentPatch.ref === newComponentRef
      ? -1
      : components.findIndex((component) => component.ref === componentPatch.ref);
    let target: WorkingComponent;
    if (index === -1) {
      // Requirement 1.E: unknown component references are upserted rather than rejected.
      if (componentPatch.delete) return;
      target = createComponent(componentPatch);
      components.push(target);
    } else {
      target = components[index]!;
      if (componentPatch.delete) {
        components.splice(index, 1);
        return;
      }
      if (componentPatch.title !== undefined) target.title = componentPatch.title;
      if (componentPatch.description !== undefined) target.description = componentPatch.description;
      target.provenance.title = target.title;
      applyItemPatches(target, componentPatch.items, componentPatch.replaceChildren);
    }
    if (componentPatch.position !== undefined) componentPositions.push({ entry: target, position: componentPatch.position, order });
  });

  const actions: WorkingAction[] = plan.actionItems.map((action) => ({
    node: structuredClone(action),
    provenance: { originRef: action.ref, title: action.title },
  }));
  const actionPositions: Array<{ entry: WorkingAction; position: number; order: number }> = [];

  patch.actionItems.forEach((actionPatch, order) => {
    const index = actionPatch.ref === newActionItemRef
      ? -1
      : actions.findIndex((action) => action.node.ref === actionPatch.ref);
    let target: WorkingAction;
    if (index === -1) {
      if (actionPatch.delete) return;
      const provenance: NodeProvenance = { originRef: null, title: actionPatch.title ?? "" };
      if (actionPatch.handle !== undefined) provenance.handle = actionPatch.handle;
      target = {
        node: {
          ref: nextActionRef(actions),
          title: actionPatch.title ?? "",
          status: actionPatch.status ?? "TODO",
          context: actionPatch.context ?? "",
          acceptanceCriteria: [],
          triggerSources: [],
          assignees: [],
        },
        provenance,
      };
      applyActionPatch(target, { ...actionPatch, title: undefined, status: undefined, context: undefined });
      actions.push(target);
    } else {
      target = actions[index]!;
      if (actionPatch.delete) {
        actions.splice(index, 1);
        return;
      }
      applyActionPatch(target, actionPatch);
    }
    if (actionPatch.position !== undefined) actionPositions.push({ entry: target, position: actionPatch.position, order });
  });

  const orderedComponents = applyPositions(components, componentPositions);
  const orderedActions = applyPositions(actions, actionPositions);

  plan.components = orderedComponents.map((component): Component => {
    const record: Record<string, unknown> = {
      ref: component.ref,
      title: component.title,
      description: component.description,
    };
    for (const section of componentItemSections) {
      record[section.key] = component.items[section.key].map(({ node }) => {
        const projected: Record<string, unknown> = { ref: node.ref, title: node.title, details: node.details };
        if (section.statuses !== null) projected.status = node.status;
        for (const subsection of section.subsections) projected[subsection.key] = node[subsection.key] ?? "";
        return projected;
      });
    }
    return record as unknown as Component;
  });
  plan.actionItems = orderedActions.map(({ node }) => node);

  const normalized = normalizePlan(plan);

  // Placeholder-titled nodes take their canonical `<Label> <ref>` title once refs are assigned.
  orderedComponents.forEach((component, componentIndex) => {
    const target = normalized.plan.components[componentIndex]!;
    for (const { key, singularLabel: label } of componentItemSections) {
      component.items[key].forEach((tracked, itemIndex) => {
        const node = (target[key] as unknown as TextItem[])[itemIndex]!;
        if (tracked.placeholderTitle) node.title = `${label} ${node.ref}`;
        tracked.provenance.title = node.title;
      });
    }
    component.provenance.title = target.title;
  });

  const provenance: PlanProvenance = {
    components: orderedComponents.map((component) => ({
      ...component.provenance,
      items: Object.fromEntries(componentItemSections.map(({ key }) => [
        key,
        component.items[key].map(({ provenance: itemProvenance }) => itemProvenance),
      ])) as Record<ComponentItemKey, NodeProvenance[]>,
    })),
    actionItems: orderedActions.map(({ provenance: actionProvenance }) => actionProvenance),
  };

  return { ...normalized, provenance };
}

/** Remove a component from a plan, renumber, and report the resulting reference changes. */
export function removePlanComponent(existing: Plan, componentRef: string): PlanPatchResult & { removed: boolean } {
  const index = existing.components.findIndex((component) => component.ref === componentRef);
  if (index === -1) {
    return { plan: existing, validationFailures: { ordering: [] }, provenance: identityProvenance(existing), removed: false };
  }
  const plan: Plan = structuredClone(existing);
  plan.components.splice(index, 1);
  const provenance = identityProvenance(plan);
  const normalized = normalizePlan(plan);
  return { ...normalized, provenance, removed: true };
}
