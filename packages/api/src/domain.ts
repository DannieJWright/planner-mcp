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
});

export type TextItem = z.infer<typeof textItemSchema>;
export type StatusItem = z.infer<typeof statusItemSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type KnowledgeGap = z.infer<typeof knowledgeGapSchema>;
export type ActionItem = z.infer<typeof actionItemSchema>;
export type Component = z.infer<typeof componentSchema>;
export type Plan = z.infer<typeof planSchema>;
export type PlanSummary = Pick<Plan, "reference" | "title" | "description" | "tags" | "status">;
