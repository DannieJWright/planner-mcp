/**
 * The Plan: the document root owning the component and action-item collections.
 */
import matter from "gray-matter";
import YAML from "yaml";
import { z } from "zod";
import { isHeadingItems, type NodeDescriptor, type NodeRange, type ParseContext, type ParseMode } from "./descriptor.js";
import { headingText, parseMarkdownNodes } from "../shared/ast.js";
import {
  duplicateRootHeading,
  invalidDocumentFields,
  missingRootHeading,
  rootHeadingOutOfOrder,
} from "../shared/errors.js";
import { refHeadingPrefix } from "../shared/refs.js";
import { actionItemDescriptor, actionItemSchema, formatActionItem, parseActionItem } from "./actionItem.js";
import { componentDescriptor, componentSchema, formatComponent, parseComponent } from "./component.js";

export const planStatuses = ["Draft", "In Progress", "Done", "Closed"] as const;

/** Reference an agent supplies to create a plan rather than update one. */
export const newPlanReference = "New";

/** Prefix of a persisted plan reference, minted on first save. */
export const planRefPrefix = "PLAN-";

/** Collections the plan owns, each grouped under a `# <heading>` in the document. */
export const planCollections = [
  { key: "components", node: componentDescriptor },
  { key: "actionItems", node: actionItemDescriptor },
] as const;

export const planSchema = z.object({
  reference: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string()),
  status: z.enum(planStatuses),
  components: z.array(componentSchema),
  actionItems: z.array(actionItemSchema),
});

export type Plan = z.infer<typeof planSchema>;
export type PlanSummary = Pick<Plan, "reference" | "title" | "description" | "tags" | "status">;

/** Frontmatter fields carrying plan metadata, and the ones a patch may override. */
export const planFrontmatterFields = ["reference", "title", "description", "tags", "status"] as const;
export const planPatchableFields = ["title", "description", "tags", "status"] as const;

export const planDescriptor: NodeDescriptor = {
  key: "plan",
  label: "plan",
  refPattern: /^.+$/,
  refPrefix: planRefPrefix,
  placeholderRef: newPlanReference,
  headingDepth: 1,
  headingBold: false,
  containerHeading: null,
  statuses: planStatuses,
  patchFields: planPatchableFields,
  sections: [],
};


/**
 * Every singular item label a `####` heading may begin with, gathered from the node
 * descriptors this plan owns.
 *
 * Computed on each call rather than captured at module load, so a section registered
 * after startup is recognized. This lives here rather than in the registry so the model
 * files stay free of a dependency on the registry, which imports them.
 */
export function itemLabels(): string[] {
  return [
    ...new Set(
      planCollections
        .flatMap(({ node }) => node.sections)
        .filter(isHeadingItems)
        .flatMap((section) => [
          section.singularLabel,
          ...section.subsections.map((subsection) => subsection.rejectNestedLabel),
        ]),
    ),
  ];
}

/** Build the parse context shared by every model in one pass over a document. */
export function createParseContext(source: string, mode: ParseMode): ParseContext {
  return { source, nodes: parseMarkdownNodes(source), mode, labels: itemLabels() };
}

/** Locate the `# <heading>` grouping each collection, enforcing presence and order. */
function locateContainers(ctx: ParseContext): Map<string, number> {
  const roots = ctx.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.type === "heading" && node.depth === planDescriptor.headingDepth);
  const located = new Map<string, number>();
  let previous: { key: string; heading: string; index: number } | undefined;

  for (const { key, node } of planCollections) {
    const heading = node.containerHeading;
    if (heading === null) continue;
    const matches = roots.filter((entry) => headingText(entry.node) === heading);
    if (matches.length === 0) throw missingRootHeading(heading);
    if (matches.length > 1) throw duplicateRootHeading(heading);
    const index = matches[0]!.index;
    if (previous && index < previous.index) throw rootHeadingOutOfOrder(heading, previous.heading);
    located.set(key, index);
    previous = { key, heading, index };
  }
  return located;
}

/** Node index ranges of each `## <PREFIX><n>` block belonging to a collection. */
function collectionRanges(
  ctx: ParseContext,
  node: typeof componentDescriptor,
  start: number,
  end: number,
): NodeRange[] {
  const prefix = refHeadingPrefix(node.refPrefix, ctx.mode === "partial");
  const starts = ctx.nodes
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) =>
      index > start
      && index < end
      && entry.type === "heading"
      && entry.depth === node.headingDepth
      && prefix.test(headingText(entry)))
    .map(({ index }) => index);
  return starts.map((value, order) => ({ start: value, end: starts[order + 1] ?? end }));
}

/**
 * Parse a complete plan document.
 *
 * This is the top of the hierarchy: it reads frontmatter, locates each collection's
 * container heading, and delegates every node to its own model, which in turn delegates
 * each section to the section walker.
 */
export function parsePlanDocument(markdown: string): Plan {
  const parsed = matter(markdown);
  const ctx = createParseContext(parsed.content, "strict");
  const containers = locateContainers(ctx);
  const componentsAt = containers.get("components")!;
  const actionsAt = containers.get("actionItems")!;

  const components = collectionRanges(ctx, componentDescriptor, componentsAt, actionsAt)
    .map((range) => parseComponent(ctx, range));
  const actionItems = collectionRanges(ctx, actionItemDescriptor, actionsAt, ctx.nodes.length)
    .map((range) => parseActionItem(ctx, range));

  const result = planSchema.safeParse({
    reference: String(parsed.data.reference ?? newPlanReference),
    title: parsed.data.title,
    description: parsed.data.description ?? "",
    tags: parsed.data.tags ?? [],
    status: parsed.data.status ?? planStatuses[0],
    components,
    actionItems,
  });
  if (!result.success) {
    const documentFields = new Set<string>(planFrontmatterFields);
    throw invalidDocumentFields(result.error.issues.map((issue) => {
      const path = documentFields.has(String(issue.path[0]))
        ? `frontmatter.${issue.path.join(".")}`
        : issue.path.join(".");
      return `\`${path || "document"}\`: ${issue.message}`;
    }));
  }
  return result.data;
}

/** Render a complete canonical plan document. */
export function formatPlanDocument(planInput: Plan): string {
  const plan = planSchema.parse(planInput);
  const frontmatter = YAML.stringify(
    Object.fromEntries(planFrontmatterFields.map((field) => [field, plan[field]])),
  ).trim();
  const table = plan.components.map((component) => `| ${component.ref} | ${component.title} |`).join("\n");
  const components = plan.components.map(formatComponent).join("\n\n");
  const actions = plan.actionItems.map(formatActionItem).join("\n\n");
  const componentsHeading = `# ${componentDescriptor.containerHeading}`;
  const actionsHeading = `# ${actionItemDescriptor.containerHeading}`;
  return `---\n${frontmatter}\n---\n\n${componentsHeading}\n\n| Ref | Short Description |\n|---|---|\n${table}\n\n${components}\n\n${actionsHeading}\n\n${actions}\n`;
}
