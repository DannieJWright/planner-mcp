import type { FastifyInstance } from "fastify";
import type { Plan } from "./domain.js";
import { componentItemSections } from "./models/component.js";
import { newPlanReference } from "./models/plan.js";
import { compareItemRefs, formatItemsExcerptMarkdown, formatPlanMarkdown, type ItemExcerptGroup } from "./markdown.js";
import {
  applyPlanPatch,
  diffReferences,
  emptyReferenceChanges,
  ingestFullPlan,
  parsePlanPatchMarkdown,
  removePlanComponent,
  type ReferenceChanges,
} from "./patch.js";
import type { PlanRepository } from "./repository.js";

type ItemQuery = { status?: string; format?: string };

const itemFormats = ["json", "markdown"] as const;

function collectGroups<T extends { ref: string }>(
  plan: Plan,
  select: (plan: Plan["components"][number]) => T[],
  status: string,
): Array<{ ref: string; title: string; items: T[] }> {
  return plan.components
    .map((component) => ({
      ref: component.ref,
      title: component.title,
      items: select(component)
        .filter((item) => status === "all" || (item as unknown as { status: string }).status === status)
        .slice()
        .sort((left, right) => compareItemRefs(left.ref, right.ref)),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Register every `/plans*` route on the generic application instance.
 *
 * The plan feature owns its own HTTP surface; `server.ts` stays document-type agnostic
 * and only wires features together.
 */
export function registerPlanRoutes(app: FastifyInstance, repository: PlanRepository): void {
  app.get("/plans", async () => ({ plans: repository.list() }));

  app.put<{ Body: string }>("/plans", async (request, reply) => {
    if (typeof request.body !== "string") return reply.code(400).send({ error: "Expected a Markdown request body" });
    try {
      const { plan, validationFailures, provenance } = ingestFullPlan(request.body);
      const existing = plan.reference === newPlanReference ? undefined : repository.get(plan.reference);
      const referenceChanges: ReferenceChanges = existing
        ? diffReferences(existing, plan, provenance)
        : emptyReferenceChanges;
      const reference = repository.save(plan);
      return { reference, validationFailures, referenceChanges };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid plan" });
    }
  });

  // Partial upload (COMP-1): merges a partial Markdown document into a persisted plan.
  app.patch<{ Params: { reference: string }; Body: string }>("/plans/:reference", async (request, reply) => {
    if (typeof request.body !== "string") return reply.code(400).send({ error: "Expected a Markdown request body" });
    const existing = repository.get(request.params.reference);
    if (!existing) return reply.code(404).send({ error: "Plan not found" });
    try {
      const patch = parsePlanPatchMarkdown(request.body);
      if (patch.reference !== existing.reference) {
        return reply.code(400).send({ error: `Plan Markdown error: frontmatter reference \`${patch.reference}\` does not match the requested plan \`${existing.reference}\`.` });
      }
      const { plan, validationFailures, provenance } = applyPlanPatch(existing, patch);
      const referenceChanges = diffReferences(existing, plan, provenance);
      const reference = repository.save(plan);
      return { reference, validationFailures, referenceChanges };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid partial plan document" });
    }
  });

  app.get<{ Params: { reference: string } }>("/plans/:reference", async (request, reply) => {
    const plan = repository.get(request.params.reference);
    if (!plan) return reply.code(404).send({ error: "Plan not found" });
    return reply.type("text/markdown; charset=utf-8").send(formatPlanMarkdown(plan));
  });

  app.delete<{ Params: { reference: string } }>("/plans/:reference", async (request, reply) => {
    if (!repository.delete(request.params.reference)) return reply.code(404).send({ error: "Plan not found" });
    return reply.code(204).send();
  });

  // Component removal (COMP-2): remove, renumber, persist, and report reference changes.
  app.delete<{ Params: { reference: string; componentRef: string } }>("/plans/:reference/components/:componentRef", async (request, reply) => {
    const existing = repository.get(request.params.reference);
    if (!existing) return reply.code(404).send({ error: "Plan not found" });
    const { plan, validationFailures, provenance, removed } = removePlanComponent(existing, request.params.componentRef);
    if (!removed) return reply.code(404).send({ error: "Component not found" });
    const referenceChanges = diffReferences(existing, plan, provenance);
    const reference = repository.save(plan);
    return { reference, validationFailures, referenceChanges };
  });

  /** `knowledgeGaps` becomes `knowledge-gaps`, `decisions` becomes `decisions`. */
  const routeSlug = (key: string): string => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

  const registerItemRoute = (
    path: string,
    label: string,
    allowedStatuses: readonly string[],
    select: (component: Plan["components"][number]) => Array<{ ref: string }>,
  ): void => {
    app.get<{ Params: { reference: string }; Querystring: ItemQuery }>(path, async (request, reply) => {
      const status = request.query.status ?? allowedStatuses[0]!;
      if (status !== "all" && !allowedStatuses.includes(status)) {
        return reply.code(400).send({ error: `Invalid status \`${status}\`. Allowed values are ${allowedStatuses.join(", ")}, all.` });
      }
      const format = request.query.format ?? "json";
      if (!itemFormats.includes(format as typeof itemFormats[number])) {
        return reply.code(400).send({ error: `Invalid format \`${format}\`. Allowed values are ${itemFormats.join(", ")}.` });
      }
      const plan = repository.get(request.params.reference);
      if (!plan) return reply.code(404).send({ error: "Plan not found" });
      const groups = collectGroups(plan, select, status);
      if (format === "markdown") {
        return reply.type("text/markdown; charset=utf-8").send(formatItemsExcerptMarkdown(plan, groups as ItemExcerptGroup[], label));
      }
      return { plan: { reference: plan.reference, title: plan.title }, components: groups };
    });
  };

  // Retrieval sub-resources: one per status-bearing component item section, so adding
  // such a section adds its retrieval route without touching this file.
  for (const section of componentItemSections) {
    if (section.statuses === null) continue;
    registerItemRoute(
      `/plans/:reference/${routeSlug(section.key)}`,
      section.singularLabel,
      section.statuses,
      (component) => (component as unknown as Record<string, Array<{ ref: string }>>)[section.key]!,
    );
  }
}
