import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { formatPlanMarkdown, parsePlanMarkdown } from "../../src/markdown.js";
import { PlanRepository } from "../../src/repository.js";
import { createServer } from "../../src/server.js";
import { samplePlan } from "../fixtures/sample-plan.js";

const execute = promisify(execFile);
let app: FastifyInstance | undefined;
let repository: PlanRepository | undefined;

afterEach(async () => {
  if (app) await app.close();
  repository?.close();
  app = undefined;
  repository = undefined;
});

describe("skill scripts", () => {
  it("syncs a file through a real HTTP listener", async () => {
    repository = new PlanRepository(":memory:");
    app = createServer({ repository });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const directory = await mkdtemp(join(tmpdir(), "planner-e2e-"));
    const planPath = join(directory, "plan with spaces.md");
    await writeFile(planPath, formatPlanMarkdown(samplePlan));
    const script = resolve(process.cwd(), "../../skills/idea-planner/scripts/sync-plan.sh");

    const { stdout } = await execute(script, [planPath], { env: { ...process.env, PLANNER_API_URL: address } });
    const reference = stdout.trim();
    expect(reference).toMatch(/^PLAN-/);
    expect(parsePlanMarkdown(await readFile(planPath, "utf8")).reference).toBe(reference);
    expect(repository.list()).toHaveLength(1);
  });
});
