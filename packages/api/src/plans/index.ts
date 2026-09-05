/**
 * Public surface of the plan feature.
 *
 * Everything that knows what a plan is lives under `src/plans/`. Generic
 * infrastructure (`server.ts`, `main.ts`) depends on this barrel and never on the
 * feature's internal file layout.
 */
export * from "./domain.js";
export * from "./markdown.js";
export * from "./patch.js";
export * from "./repository.js";
export * from "./routes.js";
