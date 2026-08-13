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
    expect(() => parsePlanMarkdown(markdown)).toThrow("Missing or invalid status");
  });

  it("rejects documents without the component root", () => {
    expect(() => parsePlanMarkdown("---\ntitle: Invalid\n---\n\nNo components")).toThrow("Missing # Components heading");
  });
});
