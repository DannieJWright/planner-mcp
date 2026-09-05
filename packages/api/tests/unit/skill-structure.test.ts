import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vitest";

const skillPath = fileURLToPath(new URL("../../../../skills/idea-planner/SKILL.md", import.meta.url));

describe("idea-planner skill structure", () => {
  it("preserves the configuration and four ordered phases", async () => {
    const skill = await readFile(skillPath, "utf8");
    const headings = fromMarkdown(skill).children
      .filter((node) => node.type === "heading")
      .map((node) => ({
        depth: node.depth,
        text: node.children.map((child) => child.type === "text" ? child.value : "").join(""),
      }));

    expect(headings).toContainEqual({ depth: 2, text: "Non-Negotiable Boundaries" });
    expect(headings).toContainEqual({ depth: 2, text: "Common Mistakes" });
    expect(headings.filter((heading) => heading.depth === 2 && heading.text.startsWith("Phase ")))
      .toEqual([
        { depth: 2, text: "Phase 0 - Decomposition" },
        { depth: 2, text: "Phase 1 - User Refinement" },
        { depth: 2, text: "Phase 2 - Ingest" },
        { depth: 2, text: "Phase 3 - Interview Phase" },
      ]);

    for (const variable of ["PLAN_FILE", "UPLOAD_SCRIPT", "DOWNLOAD_SCRIPT", "SYNC_SCRIPT"]) {
      expect(skill).toContain(`| (\`${variable}\`) |`);
    }

    const interviewPhase = skill.slice(skill.indexOf("## Phase 3 - Interview Phase"), skill.indexOf("## Output:"));
    expect(interviewPhase).toContain("access scope");
    expect(interviewPhase).toContain("(`SYNC_SCRIPT`)");
    // The phase must state its precondition instead of assuming the plan was ingested.
    expect(interviewPhase).toContain("Phase 2");
  });
});
