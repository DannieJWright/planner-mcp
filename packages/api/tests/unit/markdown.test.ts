import { describe, expect, it } from "vitest";
import { formatPlanMarkdown, parsePlanMarkdown } from "../../src/markdown.js";
import { samplePlan } from "../fixtures/sample-plan.js";

describe("plan Markdown", () => {
  it("round-trips every classified item", () => {
    const markdown = formatPlanMarkdown(samplePlan);
    expect(parsePlanMarkdown(markdown)).toEqual(samplePlan);
    expect(markdown).toContain("> Regarding monthly reviews");
  });

  it("rejects decisions without a status", () => {
    const markdown = formatPlanMarkdown(samplePlan).replace("**Status:** Open\n\nChoose batch", "Choose batch");
    expect(() => parsePlanMarkdown(markdown)).toThrow("Decision 1.A has missing required status. Add `**Status:** Open` immediately below the heading; allowed values are Open, Decided, Resolved, and Closed.");
  });

  it("reports invalid statuses with the item and accepted values", () => {
    const markdown = formatPlanMarkdown(samplePlan).replace("**Status:** Open", "**Status:** Answered");
    expect(() => parsePlanMarkdown(markdown)).toThrow("Decision 1.A has invalid status `Answered`");
  });

  it("rejects documents without the component root", () => {
    expect(() => parsePlanMarkdown("---\ntitle: Invalid\n---\n\nNo components")).toThrow("missing required `# Components` heading");
  });

  it("identifies missing frontmatter fields", () => {
    const markdown = formatPlanMarkdown(samplePlan).replace("title: Analytics refresh\n", "");
    expect(() => parsePlanMarkdown(markdown)).toThrow("`frontmatter.title`: Required");
  });

  it("preserves fenced and inline code in section content", () => {
    const details = "Run `npm test` before upload.\n\n```markdown\n### This heading is code\n`inline in code`\n```";
    const plan = {
      ...samplePlan,
      components: [{ ...samplePlan.components[0]!, requirements: [{ ref: "1.A", title: "Code example", details }] }],
    };

    const parsed = parsePlanMarkdown(formatPlanMarkdown(plan));
    expect(parsed.components[0]?.requirements[0]?.details).toBe(details);
    expect(formatPlanMarkdown(parsed)).toContain(details);
  });
});
