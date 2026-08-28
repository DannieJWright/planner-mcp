/**
 * The Plan: the document root owning the component and action-item collections.
 */
import { z } from "zod";
import type { NodeDescriptor } from "./descriptor.js";
import { actionItemDescriptor, actionItemSchema } from "./actionItem.js";
import { componentDescriptor, componentSchema } from "./component.js";

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
  containerHeading: null,
  statuses: planStatuses,
  patchFields: planPatchableFields,
  sections: [],
};
