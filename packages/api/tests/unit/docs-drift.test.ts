import { readFileSync, existsSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allBulletListSections,
  allHeadingItemSections,
  allProseSections,
} from "../../src/plans/models/registry.js";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const srcRoot = fileURLToPath(new URL("../../src", import.meta.url));

const read = (path: string): string => readFileSync(join(repoRoot, path), "utf8");
const models = read("docs/MODELS.md");
const repositoryMap = read("docs/REPOSITORY_MAP.md");
const agents = read("AGENTS.md");
const readme = read("README.md");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/**
 * The descriptor system only pays off if it is documented. These tests fail when the
 * documentation falls behind the code: a new model file that nobody described, a section
 * missing from the reference, or a doc pointing at a path that no longer exists.
 */
describe("documentation drift", () => {
  it("describes every model file in docs/MODELS.md", () => {
    const modelFiles = sourceFiles(join(srcRoot, "plans", "models"))
      .map((path) => relative(srcRoot, path).replaceAll("\\", "/").split("/").pop()!);
    const undocumented = modelFiles.filter((file) => !models.includes(file));
    expect(undocumented).toEqual([]);
  });

  it("describes every shared module in docs/MODELS.md", () => {
    const sharedFiles = sourceFiles(join(srcRoot, "plans", "shared"))
      .map((path) => path.split("/").pop()!);
    expect(sharedFiles.filter((file) => !models.includes(file))).toEqual([]);
  });

  it("names every section heading in docs/MODELS.md", () => {
    const headings = [
      ...allHeadingItemSections().map((section) => section.heading),
      ...allBulletListSections().map((section) => section.heading),
      ...allProseSections().map((subsection) => subsection.heading),
    ];
    expect(headings.filter((heading) => !models.includes(heading))).toEqual([]);
  });

  it("documents every field of the heading-item descriptor", () => {
    const fields = Object.keys(allHeadingItemSections()[0]!).filter((field) => field !== "shape");
    expect(fields.filter((field) => !models.includes(field))).toEqual([]);
  });

  it("documents the item model contract", () => {
    for (const member of ["fromParsed", "format", "toRow", "fromRow", "schema"]) {
      expect(models).toContain(member);
    }
  });

  it("provides both walkthroughs", () => {
    expect(models).toContain("Walkthrough: adding a component subsection");
    expect(models).toContain("Walkthrough: adding a field to an existing model");
  });

  it("references only paths that exist", () => {
    const documents = [models, repositoryMap, agents, readme].join("\n");
    const referenced = [...documents.matchAll(/`((?:packages|docs|skills)\/[\w./-]+?)`/g)]
      .map((match) => match[1]!)
      .filter((path) => /\.(ts|md|sh|json)$/.test(path));
    const missing = [...new Set(referenced)].filter((path) => !existsSync(join(repoRoot, path)));
    expect(missing).toEqual([]);
  });

  it("does not describe modules the refactor removed", () => {
    const documents = [repositoryMap, agents, readme].join("\n");
    for (const stale of ["src/domain.ts", "src/markdown.ts", "src/patch.ts", "src/repository.ts", "referenceTypes"]) {
      expect(documents).not.toContain(stale);
    }
  });

  it("attributes partial-document normalization to models/normalize.ts in the repository map", () => {
    // Normalization (renumbering and prose rewriting) lives in models/normalize.ts; a
    // runtime-flow step that names another module for it is stale documentation.
    const steps = repositoryMap.split("\n").filter((line) => /^\d+\./.test(line));
    const partialStep = steps.find((step) => step.includes("partial document"));
    expect(partialStep, "the runtime flow must describe the partial-document path").toBeDefined();
    expect(partialStep!).toContain("`models/normalize.ts`");
  });

  it("ends repository dotfiles with a trailing newline", () => {
    expect(read(".gitignore")).toMatch(/\n$/);
  });
});
