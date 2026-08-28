/**
 * Compatibility shim.
 *
 * The authoritative model definitions now live in `./models/`. This module only
 * re-exports them so existing import paths keep working. Add new schemas and types to
 * the owning model file, not here.
 */
import { z } from "zod";
import { decisionStatuses } from "./models/decision.js";
import { knowledgeGapStatuses } from "./models/knowledgeGap.js";
import { textItemSchema } from "./models/textItem.js";

export { textItemSchema, type TextItem } from "./models/textItem.js";
export { decisionSchema, decisionStatuses, type Decision } from "./models/decision.js";
export { knowledgeGapSchema, knowledgeGapStatuses, type KnowledgeGap } from "./models/knowledgeGap.js";
export { actionItemSchema, actionItemStatuses, type ActionItem } from "./models/actionItem.js";
export { componentSchema, type Component } from "./models/component.js";
export { planSchema, planStatuses, type Plan, type PlanSummary } from "./models/plan.js";

/** Union of every component item status, retained for callers that accept either kind. */
export const itemStatuses = [
  ...new Set<string>([...decisionStatuses, ...knowledgeGapStatuses]),
] as unknown as readonly ["Open", "Decided", "Resolved", "Closed"];

const statusItemSchema = textItemSchema.extend({
  status: z.enum(itemStatuses),
});

export type StatusItem = z.infer<typeof statusItemSchema>;
