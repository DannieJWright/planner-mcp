import Fastify, { type FastifyInstance } from "fastify";
import { decisionStatuses, knowledgeGapStatuses, type Decision, type KnowledgeGap, type Plan } from "./domain.js";
import { compareItemRefs, formatItemsExcerptMarkdown, formatPlanMarkdown, ingestPlanMarkdown, type ItemExcerptGroup } from "./markdown.js";
import {
  applyPlanPatch,
  diffReferences,
  emptyReferenceChanges,
  identityProvenance,
  parsePlanPatchMarkdown,
  removePlanComponent,
  type ReferenceChanges,
} from "./patch.js";
import { PlanRepository } from "./repository.js";

export type ServerOptions = {
  repository?: PlanRepository;
  logger?: boolean;
};

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

export function createServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const repository = options.repository ?? new PlanRepository();
  const ownsRepository = !options.repository;

  app.addContentTypeParser(["text/markdown", "text/plain"], { parseAs: "string" }, (_request, body, done) => done(null, body));

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/plans", async () => ({ plans: repository.list() }));

  app.put<{ Body: string }>("/plans", async (request, reply) => {
    if (typeof request.body !== "string") return reply.code(400).send({ error: "Expected a Markdown request body" });
    try {
      const { plan, validationFailures } = ingestPlanMarkdown(request.body);
      const existing = plan.reference === "New" ? undefined : repository.get(plan.reference);
      const referenceChanges: ReferenceChanges = existing
        ? diffReferences(existing, plan, identityProvenance(plan))
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

  const registerItemRoute = (
    path: string,
    label: string,
    allowedStatuses: readonly string[],
    select: (component: Plan["components"][number]) => Array<KnowledgeGap | Decision>,
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

  // Retrieval sub-resources (COMP-3 / COMP-4).
  registerItemRoute("/plans/:reference/knowledge-gaps", "Knowledge Gap", knowledgeGapStatuses, (component) => component.knowledgeGaps);
  registerItemRoute("/plans/:reference/decisions", "Decision", decisionStatuses, (component) => component.decisions);

  if (ownsRepository) app.addHook("onClose", async () => repository.close());
  return app;
}
