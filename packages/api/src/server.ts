import Fastify, { type FastifyInstance } from "fastify";
import { formatPlanMarkdown, ingestPlanMarkdown } from "./markdown.js";
import { PlanRepository } from "./repository.js";

export type ServerOptions = {
  repository?: PlanRepository;
  logger?: boolean;
};

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
      const reference = repository.save(plan);
      return { reference, validationFailures };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid plan" });
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

  if (ownsRepository) app.addHook("onClose", async () => repository.close());
  return app;
}
