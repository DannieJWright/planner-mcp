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
    const formattedDetails = "Run `npm test`.\n\n```markdown\n### This heading is code\n`inline in code`\n```";
    const plan = {
      ...samplePlan,
      components: [{ ...samplePlan.components[0]!, ref: "COMP-4", requirements: [{ ref: "4.A", title: "Code example", details: formattedDetails }] }],
    };
    await writeFile(planPath, formatPlanMarkdown(plan));
    const script = resolve(process.cwd(), "../../skills/idea-planner/scripts/sync-plan.sh");

    const { stdout } = await execute(script, [planPath], { env: { ...process.env, PLANNER_API_URL: address } });
    const reference = stdout.trim();
    expect(reference).toMatch(/^PLAN-/);
    const syncedMarkdown = await readFile(planPath, "utf8");
    expect(parsePlanMarkdown(syncedMarkdown).reference).toBe(reference);
    expect(syncedMarkdown).toContain("## **COMP-1 - Data management strategy**");
    expect(syncedMarkdown).toContain("#### Requirement 1.A - Code example");
    expect(syncedMarkdown).toContain(formattedDetails);
    expect(repository.get(reference)?.components[0]?.requirements[0]?.details).toBe(formattedDetails);
    expect(repository.list()).toHaveLength(1);
  });

  it("prints actionable API validation errors", async () => {
    repository = new PlanRepository(":memory:");
    app = createServer({ repository });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const directory = await mkdtemp(join(tmpdir(), "planner-e2e-"));
    const planPath = join(directory, "invalid-plan.md");
    const invalidPlan = formatPlanMarkdown(samplePlan).replace("**Status:** Open\n\nChoose batch", "Choose batch");
    await writeFile(planPath, invalidPlan);
    const script = resolve(process.cwd(), "../../skills/idea-planner/scripts/upload-plan.sh");

    await expect(execute(script, [planPath], { env: { ...process.env, PLANNER_API_URL: address } })).rejects.toMatchObject({
      stderr: expect.stringContaining("Decision 1.A has missing required status. Add `**Status:** Open`"),
    });
  });
});
