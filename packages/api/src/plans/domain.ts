/**
 * Compatibility shim.
 *
 * The authoritative model definitions now live in `./models/`. This module only
 * re-exports them so existing import paths keep working. Add new schemas and types to
 * the owning model file, not here.
 */
import { z } from "zod";
import { textItemSchema } from "./models/textItem.js";

export { textItemSchema, type TextItem } from "./models/textItem.js";
export { decisionSchema, decisionStatuses, type Decision } from "./models/decision.js";
export { knowledgeGapSchema, knowledgeGapStatuses, type KnowledgeGap } from "./models/knowledgeGap.js";
export { actionItemSchema, actionItemStatuses, type ActionItem } from "./models/actionItem.js";
export { componentSchema, type Component } from "./models/component.js";
export { planSchema, planStatuses, type Plan, type PlanSummary } from "./models/plan.js";

/**
 * Union of every component item status, retained for callers that accept either kind.
 *
 * This is an explicit literal rather than a derivation: it is part of the public API with
 * a stable order and shape by construction, and `registry-consistency.test.ts` keeps its
 * values in sync with the decision and knowledge-gap descriptors.
 */
export const itemStatuses = ["Open", "Decided", "Resolved", "Closed"] as const;

const statusItemSchema = textItemSchema.extend({
  status: z.enum(itemStatuses),
});

export type StatusItem = z.infer<typeof statusItemSchema>;
