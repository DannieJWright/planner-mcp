import matter from "gray-matter";
import {
  actionItemStatuses,
  decisionStatuses,
  knowledgeGapStatuses,
  planStatuses,
  type ActionItem,
  type Component,
  type KnowledgeGap,
  type Plan,
  type TextItem,
} from "./domain.js";
import {
  componentSections,
  contentBetween,
  lineLocation,
  nodeText,
  normalizePlan,
  parseItemHeading,
  parseLeadingMetadata,
  parseMarkdownNodes,
  subsectionLabel,
  type ComponentItemKey,
  type MarkdownNode,
  type PlanIngestResult,
} from "./markdown.js";

/* -------------------------------------------------------------------------- */
/* Patch model                                                                */
/* -------------------------------------------------------------------------- */

export const newComponentRef = "COMP-New";
export const newActionItemRef = "ACTION-New";
export const newItemRef = "New";

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
      items: Object.fromEntries(componentSections.map(({ key }) => [
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
    for (const { key } of componentSections) {
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
    for (const { key } of componentSections) {
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

const componentMetadataKeys = ["Delete", "Replace", "Position", "Handle"] as const;
const itemMetadataKeys = ["Status", "Delete", "Handle"] as const;
const actionMetadataKeys = ["Status", "Delete", "Position", "Handle"] as const;

function headingText(node: MarkdownNode): string {
  return nodeText(node).replace(/\*\*/g, "").trim();
}

function parseBoolean(value: string, field: string, context: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  throw new Error(`Plan Markdown error: ${context} has an invalid \`${field}\` value \`${value}\`. Expected \`true\` or \`false\`.`);
}

function parsePosition(value: string, context: string): number {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`Plan Markdown error: ${context} has an invalid \`Position\` value \`${value}\`. Expected a whole number.`);
  }
  return parsed;
}

function headingIndexes(nodes: MarkdownNode[], start: number, end: number, depth: number): number[] {
  const indexes: number[] = [];
  for (let index = start; index < end; index += 1) {
    const node = nodes[index]!;
    if (node.type === "heading" && node.depth === depth) indexes.push(index);
  }
  return indexes;
}

function nextBoundary(nodes: MarkdownNode[], start: number, end: number, depth: number): number {
  for (let index = start; index < end; index += 1) {
    const node = nodes[index]!;
    if (node.type === "heading" && (node.depth ?? 7) <= depth) return index;
  }
  return end;
}

function parsePartialItems(content: string, nodes: MarkdownNode[], start: number, end: number, kind: ComponentItemKey): ItemPatch[] {
  const section = componentSections.find((entry) => entry.key === kind)!;
  const statuses = kind === "decisions" ? decisionStatuses : kind === "knowledgeGaps" ? knowledgeGapStatuses : undefined;
  const starts = headingIndexes(nodes, start, end, 4);
  return starts.map((itemStart, order) => {
    const node = nodes[itemStart]!;
    const heading = headingText(node);
    const parsed = parseItemHeading(heading);
    if (!parsed) {
      throw new Error(`Plan Markdown error${lineLocation(node)}: invalid item heading \`${heading}\`. Expected \`#### <Item Type> <reference> - <title>\`, for example \`#### Requirement 1.A - Upload plans\`.`);
    }
    const itemEnd = starts[order + 1] ?? end;
    const context = `${section.label} ${parsed.ref}`;
    const findingsHeading = kind === "knowledgeGaps"
      ? headingIndexes(nodes, itemStart + 1, itemEnd, 5).find((index) => headingText(nodes[index]!) === "Findings")
      : undefined;
    const bodyEnd = findingsHeading ?? itemEnd;
    const body = contentBetween(content, nodes.slice(0, bodyEnd), itemStart + 1, 4);
    const { fields, rest } = parseLeadingMetadata(body, itemMetadataKeys, context);

    const value: ItemPatchValue = {};
    if (parsed.title !== undefined) value.title = parsed.title;
    if (rest) value.details = kind === "questions" ? rest.replace(/^>\s?/, "") : rest;
    if (fields.Status !== undefined) {
      if (!statuses) throw new Error(`Plan Markdown error${lineLocation(node)}: ${context} does not support a \`Status\` metadata field.`);
      const status = statuses.find((candidate) => candidate.toLowerCase() === fields.Status!.toLowerCase());
      if (!status) throw new Error(`Plan Markdown error${lineLocation(node)}: ${context} has invalid status \`${fields.Status}\`; allowed values are ${statuses.join(", ")}.`);
      value.status = status;
    }
    if (findingsHeading !== undefined) {
      value.findings = contentBetween(content, nodes.slice(0, itemEnd), findingsHeading + 1, 5);
    }

    const patch: ItemPatch = {
      kind,
      ref: parsed.ref,
      delete: fields.Delete === undefined ? false : parseBoolean(fields.Delete, "Delete", context),
      value,
    };
    if (fields.Handle !== undefined) patch.handle = fields.Handle;
    return patch;
  });
}

function parsePartialComponent(content: string, nodes: MarkdownNode[], start: number, end: number): ComponentPatch {
  const node = nodes[start]!;
  const heading = headingText(node);
  const match = heading.match(/^(COMP-(?:\d+|New))\s*-\s*(.+)$/i);
  if (!match) throw new Error(`Plan Markdown error${lineLocation(node)}: invalid component heading \`${heading}\`. Expected \`## **COMP-<number|New> - <title>**\`.`);
  const ref = match[1]!.replace(/^comp-/i, "COMP-").replace(/new$/i, "New");
  const context = ref;

  const sectionIndexes = new Map<ComponentItemKey, number>();
  for (const index of headingIndexes(nodes, start + 1, end, 3)) {
    const name = headingText(nodes[index]!);
    const section = componentSections.find((entry) => entry.section === name);
    if (!section) throw new Error(`Plan Markdown error${lineLocation(nodes[index]!)}: ${ref} contains unsupported \`### ${name}\` subsection.`);
    if (sectionIndexes.has(section.key)) throw new Error(`Plan Markdown error${lineLocation(nodes[index]!)}: ${ref} contains duplicate \`### ${name}\` subsections.`);
    sectionIndexes.set(section.key, index);
  }

  const preamble = contentBetween(content, nodes.slice(0, nextBoundary(nodes, start + 1, end, 3)), start + 1, 3);
  const { fields, rest } = parseLeadingMetadata(preamble, componentMetadataKeys, context);

  const ordered = [...sectionIndexes.entries()].sort((left, right) => left[1] - right[1]);
  const items = ordered.flatMap(([kind, sectionStart], order) => {
    const sectionEnd = ordered[order + 1]?.[1] ?? end;
    return parsePartialItems(content, nodes, sectionStart + 1, sectionEnd, kind);
  });

  const patch: ComponentPatch = {
    ref,
    delete: fields.Delete === undefined ? false : parseBoolean(fields.Delete, "Delete", context),
    replaceChildren: fields.Replace === undefined ? false : parseBoolean(fields.Replace, "Replace", context),
    title: match[2]!.trim(),
    items,
  };
  if (rest) patch.description = rest;
  if (fields.Position !== undefined) patch.position = parsePosition(fields.Position, context);
  if (fields.Handle !== undefined) patch.handle = fields.Handle;
  return patch;
}

function parseBulletList(node: MarkdownNode | undefined): string[] {
  if (node?.type !== "list") return [];
  return (node.children ?? []).map((item) => nodeText(item).trim()).filter(Boolean);
}

function parsePartialActionItem(content: string, nodes: MarkdownNode[], start: number, end: number): ActionItemPatch {
  const node = nodes[start]!;
  const heading = headingText(node);
  const match = heading.match(/^(ACTION-(?:\d+|New))\s*-\s*(.+)$/i);
  if (!match) throw new Error(`Plan Markdown error${lineLocation(node)}: invalid action item heading \`${heading}\`. Expected \`## **ACTION-<number|New> - <title>**\`.`);
  const ref = match[1]!.replace(/^action-/i, "ACTION-").replace(/new$/i, "New");
  const context = ref;

  const sectionIndexes = new Map<string, number>();
  for (const index of headingIndexes(nodes, start + 1, end, 3)) {
    const name = headingText(nodes[index]!);
    if (!["Acceptance Criteria", "Trigger Sources", "Assignees"].includes(name)) {
      throw new Error(`Plan Markdown error${lineLocation(nodes[index]!)}: ${ref} contains unsupported \`### ${name}\` subsection.`);
    }
    if (sectionIndexes.has(name)) throw new Error(`Plan Markdown error${lineLocation(nodes[index]!)}: ${ref} contains duplicate \`### ${name}\` subsections.`);
    sectionIndexes.set(name, index);
  }
  const sectionEnd = (sectionStart: number): number => [...sectionIndexes.values()].filter((value) => value > sectionStart).sort((a, b) => a - b)[0] ?? end;

  const preamble = contentBetween(content, nodes.slice(0, nextBoundary(nodes, start + 1, end, 3)), start + 1, 3);
  const { fields, rest } = parseLeadingMetadata(preamble, actionMetadataKeys, context);

  const patch: ActionItemPatch = {
    ref,
    delete: fields.Delete === undefined ? false : parseBoolean(fields.Delete, "Delete", context),
    title: match[2]!.trim(),
  };
  if (rest) patch.context = rest;
  if (fields.Position !== undefined) patch.position = parsePosition(fields.Position, context);
  if (fields.Handle !== undefined) patch.handle = fields.Handle;
  if (fields.Status !== undefined) {
    const status = actionItemStatuses.find((candidate) => candidate.toLowerCase() === fields.Status!.toLowerCase());
    if (!status) throw new Error(`Plan Markdown error${lineLocation(node)}: ${ref} has invalid status \`${fields.Status}\`; allowed values are ${actionItemStatuses.join(", ")}.`);
    patch.status = status;
  }

  const acceptanceStart = sectionIndexes.get("Acceptance Criteria");
  if (acceptanceStart !== undefined) {
    patch.acceptanceCriteria = parsePartialItems(content, nodes, acceptanceStart + 1, sectionEnd(acceptanceStart), "requirements").map((item) => {
      const criterion: NonNullable<ActionItemPatch["acceptanceCriteria"]>[number] = { ref: item.ref, delete: item.delete };
      if (item.value.title !== undefined) criterion.title = item.value.title;
      if (item.value.details !== undefined) criterion.details = item.value.details;
      if (item.handle !== undefined) criterion.handle = item.handle;
      return criterion;
    });
  }
  const triggerStart = sectionIndexes.get("Trigger Sources");
  if (triggerStart !== undefined) {
    patch.triggerSources = parseBulletList(nodes.slice(triggerStart + 1, sectionEnd(triggerStart)).find((entry) => entry.type === "list")).map((entry) => {
      const source = entry.match(/^(.+?)\s+-\s+(.+)$/);
      if (!source) throw new Error(`Plan Markdown error: invalid trigger source \`${entry}\`. Expected \`- <reference> - <short description>\`.`);
      return { ref: source[1]!, title: source[2]! };
    });
  }
  const assigneesStart = sectionIndexes.get("Assignees");
  if (assigneesStart !== undefined) {
    patch.assignees = parseBulletList(nodes.slice(assigneesStart + 1, sectionEnd(assigneesStart)).find((entry) => entry.type === "list"));
  }
  return patch;
}

/**
 * Parse a partial plan document: a Markdown plan document that may omit anything that is
 * not being changed. Root headings and component subsections are optional, references may
 * be `New` placeholders, and nodes may carry `Delete`/`Replace`/`Position`/`Handle`
 * metadata fields.
 */
export function parsePlanPatchMarkdown(markdown: string): PlanPatch {
  const parsed = matter(markdown);
  const reference = parsed.data.reference === undefined ? "" : String(parsed.data.reference).trim();
  if (!reference || reference.toLowerCase() === "new") {
    throw new Error("Plan Markdown error: a partial plan document must carry the persisted plan `reference` in its frontmatter.");
  }
  const content = parsed.content;
  const nodes = parseMarkdownNodes(content);
  const blockStarts = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.type === "heading" && (node.depth === 1 || node.depth === 2))
    .map(({ index }) => index);

  const components: ComponentPatch[] = [];
  const actionItems: ActionItemPatch[] = [];
  blockStarts.forEach((start, order) => {
    const node = nodes[start]!;
    if (node.depth === 1) return;
    const end = blockStarts[order + 1] ?? nodes.length;
    const heading = headingText(node);
    if (/^COMP-(?:\d+|New)\s*-/i.test(heading)) components.push(parsePartialComponent(content, nodes, start, end));
    else if (/^ACTION-(?:\d+|New)\s*-/i.test(heading)) actionItems.push(parsePartialActionItem(content, nodes, start, end));
    else throw new Error(`Plan Markdown error${lineLocation(node)}: unsupported \`## ${heading}\` heading. Expected \`COMP-<number|New> - <title>\` or \`ACTION-<number|New> - <title>\`.`);
  });

  const meta: PlanPatch["meta"] = {};
  if (parsed.data.title !== undefined) meta.title = String(parsed.data.title);
  if (parsed.data.description !== undefined) meta.description = String(parsed.data.description);
  if (parsed.data.tags !== undefined) meta.tags = (parsed.data.tags as unknown[]).map((tag) => String(tag));
  if (parsed.data.status !== undefined) {
    const status = planStatuses.find((candidate) => candidate.toLowerCase() === String(parsed.data.status).toLowerCase());
    if (!status) throw new Error(`Plan Markdown error: invalid frontmatter status \`${String(parsed.data.status)}\`; allowed values are ${planStatuses.join(", ")}.`);
    meta.status = status;
  }

  return { reference, meta, components, actionItems };
}

/* -------------------------------------------------------------------------- */
/* Merge engine                                                               */
/* -------------------------------------------------------------------------- */

type ItemNode = TextItem & { status?: string; findings?: string };

type TrackedItem = {
  node: ItemNode;
  provenance: NodeProvenance;
  placeholderTitle: boolean;
};

function emptyItemBuckets(): Record<ComponentItemKey, TrackedItem[]> {
  return { requirements: [], constraints: [], decisions: [], knowledgeGaps: [], notes: [], questions: [] };
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
    items: Object.fromEntries(componentSections.map(({ key }) => [
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

function applyItemValue(node: ItemNode, value: ItemPatchValue): void {
  if (value.title !== undefined) node.title = value.title;
  if (value.details !== undefined) node.details = value.details;
  if (value.status !== undefined) node.status = value.status;
  if (value.findings !== undefined) node.findings = value.findings;
}

function createItem(patch: ItemPatch): TrackedItem {
  const label = componentSections.find((entry) => entry.key === patch.kind)!.label;
  const node: ItemNode = { ref: newItemRef, title: patch.value.title ?? `${label} ${newItemRef}`, details: patch.value.details ?? "" };
  if (patch.kind === "decisions") node.status = patch.value.status ?? "Open";
  if (patch.kind === "knowledgeGaps") {
    node.status = patch.value.status ?? "Open";
    node.findings = patch.value.findings ?? "";
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
        applyItemValue(existing.node, patch.value);
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
    applyItemValue(tracked.node, patch.value);
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
  const numbers = actions.map((action) => Number(action.node.ref.slice("ACTION-".length))).filter(Number.isFinite);
  return `ACTION-${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
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
        action.node.acceptanceCriteria.push({ ref, title: criterion.title ?? `Acceptance Criteria ${ref}`, details: criterion.details ?? "" });
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

  plan.components = orderedComponents.map((component): Component => ({
    ref: component.ref,
    title: component.title,
    description: component.description,
    requirements: component.items.requirements.map(({ node }) => ({ ref: node.ref, title: node.title, details: node.details })),
    constraints: component.items.constraints.map(({ node }) => ({ ref: node.ref, title: node.title, details: node.details })),
    decisions: component.items.decisions.map(({ node }) => ({ ref: node.ref, title: node.title, details: node.details, status: node.status as Component["decisions"][number]["status"] })),
    knowledgeGaps: component.items.knowledgeGaps.map(({ node }): KnowledgeGap => ({
      ref: node.ref,
      title: node.title,
      details: node.details,
      status: node.status as KnowledgeGap["status"],
      findings: node.findings ?? "",
    })),
    notes: component.items.notes.map(({ node }) => ({ ref: node.ref, title: node.title, details: node.details })),
    questions: component.items.questions.map(({ node }) => ({ ref: node.ref, title: node.title, details: node.details })),
  }));
  plan.actionItems = orderedActions.map(({ node }) => node);

  const normalized = normalizePlan(plan);

  // Placeholder-titled nodes take their canonical `<Label> <ref>` title once refs are assigned.
  orderedComponents.forEach((component, componentIndex) => {
    const target = normalized.plan.components[componentIndex]!;
    for (const { key, label } of componentSections) {
      component.items[key].forEach((tracked, itemIndex) => {
        const node = (target[key] as TextItem[])[itemIndex]!;
        if (tracked.placeholderTitle) node.title = `${label} ${node.ref}`;
        tracked.provenance.title = node.title;
      });
    }
    component.provenance.title = target.title;
  });

  const provenance: PlanProvenance = {
    components: orderedComponents.map((component) => ({
      ...component.provenance,
      items: Object.fromEntries(componentSections.map(({ key }) => [
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
