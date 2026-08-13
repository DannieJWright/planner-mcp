import { z } from "zod";

export const planStatuses = ["Draft", "In Progress", "Done", "Closed"] as const;
export const itemStatuses = ["Open", "Decided", "Resolved", "Closed"] as const;

const textItemSchema = z.object({
  ref: z.string().min(1),
  title: z.string().min(1),
  details: z.string(),
});

const statusItemSchema = textItemSchema.extend({
  status: z.enum(itemStatuses),
});

export const componentSchema = z.object({
  ref: z.string().regex(/^COMP-\d+$/),
  title: z.string().min(1),
  description: z.string(),
  requirements: z.array(textItemSchema),
  constraints: z.array(textItemSchema),
  decisions: z.array(statusItemSchema),
  knowledgeGaps: z.array(statusItemSchema),
  findings: z.array(textItemSchema),
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
});

export type TextItem = z.infer<typeof textItemSchema>;
export type StatusItem = z.infer<typeof statusItemSchema>;
export type Component = z.infer<typeof componentSchema>;
export type Plan = z.infer<typeof planSchema>;
export type PlanSummary = Pick<Plan, "reference" | "title" | "description" | "tags" | "status">;
