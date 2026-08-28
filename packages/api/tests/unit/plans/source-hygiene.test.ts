import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allBulletListSections,
  allHeadingItemSections,
  allProseSections,
} from "../../../src/plans/models/registry.js";

const srcRoot = fileURLToPath(new URL("../../../src", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const files = sourceFiles(srcRoot).map((path) => ({
  path: relative(srcRoot, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));

/** Files allowed to spell a given piece of plan vocabulary. */
function offenders(needle: string, allowed: string[]): string[] {
  return files
    .filter(({ path }) => !allowed.includes(path))
    .filter(({ text }) => text.includes(needle))
    .map(({ path }) => path);
}

/**
 * The point of the descriptor registry is that plan vocabulary is spelled once. These
 * tests fail if a section name, item label, or reference prefix leaks back into a call
 * site, which is exactly how the previous parallel tables drifted apart.
 */
describe("source hygiene", () => {
  const sectionOwners: Record<string, string> = {
    Requirements: "plans/models/component.ts",
    Constraints: "plans/models/component.ts",
    Notes: "plans/models/component.ts",
    "Open Questions": "plans/models/component.ts",
    Decisions: "plans/models/decision.ts",
    "Knowledge Gaps": "plans/models/knowledgeGap.ts",
    Findings: "plans/models/knowledgeGap.ts",
    "Acceptance Criteria": "plans/models/actionItem.ts",
    "Trigger Sources": "plans/models/actionItem.ts",
    Assignees: "plans/models/actionItem.ts",
  };

  it("declares every section heading in exactly one model file", () => {
    const headings = [
      ...allHeadingItemSections().map((section) => section.heading),
      ...allBulletListSections().map((section) => section.heading),
      ...allProseSections().map((subsection) => subsection.heading),
    ];
    for (const heading of headings) {
      const owner = sectionOwners[heading];
      expect(owner, `no declared owner for section \`${heading}\``).toBeDefined();
      expect(offenders(`"${heading}"`, [owner!])).toEqual([]);
    }
  });

  it("declares every singular item label in exactly one model file", () => {
    for (const section of allHeadingItemSections()) {
      const owner = sectionOwners[section.heading]!;
      expect(offenders(`"${section.singularLabel}"`, [owner])).toEqual([]);
    }
  });

  it("spells reference prefixes only where they are declared", () => {
    // shared/refs.ts builds every matcher; the two node models declare their prefix.
    expect(offenders('"COMP-"', ["plans/models/component.ts"])).toEqual([]);
    expect(offenders('"ACTION-"', ["plans/models/actionItem.ts"])).toEqual([]);
    expect(offenders('"PLAN-"', ["plans/models/plan.ts"])).toEqual([]);
  });

  it("spells the New placeholder only in shared/refs.ts and plan.ts", () => {
    expect(offenders('"New"', ["plans/shared/refs.ts", "plans/models/plan.ts"])).toEqual([]);
  });

  it("declares persistence kinds only in the owning model files", () => {
    const kindOwners: Record<string, string> = {
      requirement: "plans/models/component.ts",
      constraint: "plans/models/component.ts",
      note: "plans/models/component.ts",
      question: "plans/models/component.ts",
      decision: "plans/models/decision.ts",
      knowledge_gap: "plans/models/knowledgeGap.ts",
    };
    for (const [kind, owner] of Object.entries(kindOwners)) {
      // The DDL and its legacy migration statement intentionally stay literal.
      expect(offenders(`"${kind}"`, [owner, "plans/repository.ts"])).toEqual([]);
    }
  });

  it("keeps document-type knowledge out of the generic server module", () => {
    const server = files.find(({ path }) => path === "server.ts")!;
    expect(server.text).toContain("registerPlanRoutes(app, repository)");
    // No route paths, no plan vocabulary, no direct dependency on feature internals.
    expect(server.text).not.toContain('"/plans');
    expect(server.text).not.toContain("Markdown");
    expect(server.text).not.toMatch(/from "\.\/plans\/(?!index\.js)/);
  });

  it("keeps domain.ts and markdown.ts free of parsing and schema logic", () => {
    const domain = files.find(({ path }) => path === "plans/domain.ts")!;
    expect(domain.text).not.toContain("z.object({\n  ref:");
    const markdown = files.find(({ path }) => path === "plans/markdown.ts")!;
    expect(markdown.text).not.toContain("function parseComponent");
    expect(markdown.text).not.toContain("function parseItems");
    expect(markdown.text).not.toContain("function renderItems");
  });

  it("routes all Markdown AST access through shared/ast.ts", () => {
    expect(offenders("mdast-util-from-markdown", ["plans/shared/ast.ts"])).toEqual([]);
  });

  it("confines raw-source offset slicing to shared/ast.ts", () => {
    // Swapping to mdast-util-to-markdown must remain a single-site change.
    expect(offenders("position?.start.offset", ["plans/shared/ast.ts"])).toEqual([]);
  });
});
