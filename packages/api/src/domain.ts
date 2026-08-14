import { z } from "zod";

export const planStatuses = ["Draft", "In Progress", "Done", "Closed"] as const;
export const decisionStatuses = ["Open", "Decided", "Closed"] as const;
export const knowledgeGapStatuses = ["Open", "Resolved", "Closed"] as const;
export const itemStatuses = ["Open", "Decided", "Resolved", "Closed"] as const;
export const actionItemStatuses = ["TODO", "In Progress", "Done", "Closed"] as const;

export const textItemSchema = z.object({
  ref: z.string().min(1),
  title: z.string().min(1),
  details: z.string(),
});

const statusItemSchema = textItemSchema.extend({
  status: z.enum(itemStatuses),
});

export const decisionSchema = textItemSchema.extend({
  status: z.enum(decisionStatuses),
});

export const knowledgeGapSchema = textItemSchema.extend({
  status: z.enum(knowledgeGapStatuses),
  findings: z.string(),
}).refine((gap) => gap.status !== "Resolved" || gap.findings.trim().length > 0, {
  message: "Resolved knowledge gaps must contain findings",
  path: ["findings"],
});

export const actionItemSchema = z.object({
  ref: z.string().regex(/^ACTION-\d+$/),
  title: z.string().min(1),
  status: z.enum(actionItemStatuses),
  context: z.string(),
  acceptanceCriteria: z.array(textItemSchema),
  triggerSources: z.array(z.object({
    ref: z.string().min(1),
    title: z.string().min(1),
  })),
  assignees: z.array(z.string().min(1)),
});

export const componentSchema = z.object({
  ref: z.string().regex(/^COMP-\d+$/),
  title: z.string().min(1),
  description: z.string(),
  requirements: z.array(textItemSchema),
  constraints: z.array(textItemSchema),
  decisions: z.array(decisionSchema),
  knowledgeGaps: z.array(knowledgeGapSchema),
  notes: z.array(textItemSchema),
  questions: z.array(textItemSchema),
});

export const planSchema = z.object({
  reference: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string()),
  status: z.enum(planStatuses),
  components: z.array(componentSchema),
  actionItems: z.array(actionItemSchema),
}).superRefine((plan, context) => {
  const sourceReferences = new Set<string>();
  for (const component of plan.components) {
    sourceReferences.add(component.ref);
    for (const item of component.requirements) sourceReferences.add(`Requirement ${item.ref}`);
    for (const item of component.constraints) sourceReferences.add(`Constraint ${item.ref}`);
    for (const item of component.decisions) sourceReferences.add(`Decision ${item.ref}`);
    for (const item of component.knowledgeGaps) sourceReferences.add(`Knowledge Gap ${item.ref}`);
    for (const item of component.notes) sourceReferences.add(`Note ${item.ref}`);
    for (const item of component.questions) sourceReferences.add(`Question ${item.ref}`);
  }
  plan.actionItems.forEach((action, actionIndex) => action.triggerSources.forEach((source, sourceIndex) => {
    if (!sourceReferences.has(source.ref)) {
      context.addIssue({
        code: "custom",
        path: ["actionItems", actionIndex, "triggerSources", sourceIndex, "ref"],
        message: `Trigger Source ${source.ref} does not resolve to a component or component item in this plan`,
      });
    }
  }));
});

export type TextItem = z.infer<typeof textItemSchema>;
export type StatusItem = z.infer<typeof statusItemSchema>;
export type KnowledgeGap = z.infer<typeof knowledgeGapSchema>;
export type ActionItem = z.infer<typeof actionItemSchema>;
export type Component = z.infer<typeof componentSchema>;
export type Plan = z.infer<typeof planSchema>;
export type PlanSummary = Pick<Plan, "reference" | "title" | "description" | "tags" | "status">;
