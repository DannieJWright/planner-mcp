import Fastify, { type FastifyInstance } from "fastify";
import { PlanRepository, registerPlanRoutes } from "./plans/index.js";

export type ServerOptions = {
  repository?: PlanRepository;
  logger?: boolean;
};

/**
 * Build the HTTP application.
 *
 * This module owns only generic concerns: the Fastify instance, body parsing,
 * `/health`, and resource lifecycle. Document-type-specific routes are registered by
 * the corresponding feature folder under `src/`.
 */
export function createServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const repository = options.repository ?? new PlanRepository();
  const ownsRepository = !options.repository;

  app.addContentTypeParser(["text/markdown", "text/plain"], { parseAs: "string" }, (_request, body, done) => done(null, body));

  app.get("/health", async () => ({ status: "ok" }));

  registerPlanRoutes(app, repository);

  if (ownsRepository) app.addHook("onClose", async () => repository.close());
  return app;
}
