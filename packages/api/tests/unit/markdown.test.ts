import { describe, expect, it } from "vitest";
import { formatPlanMarkdown, ingestPlanMarkdown, parsePlanMarkdown } from "../../src/markdown.js";
import { samplePlan } from "../fixtures/sample-plan.js";

describe("plan Markdown", () => {
  it("round-trips every classified item", () => {
    const markdown = formatPlanMarkdown(samplePlan);
    expect(parsePlanMarkdown(markdown)).toEqual(samplePlan);
    expect(markdown).toContain("> Regarding monthly reviews");
    expect(markdown).toContain("##### Findings\n\nPeak volume is 400 events per second.");
    expect(markdown).toContain("# Action Items");
  });

  it("rejects decisions without a status", () => {
    const markdown = formatPlanMarkdown(samplePlan).replace("**Status:** Open\n\nChoose batch", "Choose batch");
    expect(() => parsePlanMarkdown(markdown)).toThrow("Decision 1.A has missing required status. Add `**Status:** Open` immediately below the heading; allowed values are Open, Decided, Closed.");
  });

  it("reports invalid statuses with the item and accepted values", () => {
    const markdown = formatPlanMarkdown(samplePlan).replace("**Status:** Open", "**Status:** Answered");
    expect(() => parsePlanMarkdown(markdown)).toThrow("Decision 1.A has invalid status `Answered`");
  });

  it("rejects knowledge-gap statuses on decisions", () => {
    const markdown = formatPlanMarkdown(samplePlan).replace("**Status:** Open\n\nChoose batch", "**Status:** Resolved\n\nChoose batch");
    expect(() => parsePlanMarkdown(markdown)).toThrow("Decision 1.A has invalid status `Resolved`");
  });

  it("rejects decision statuses on knowledge gaps", () => {
    const markdown = formatPlanMarkdown(samplePlan).replace("**Status:** Open\n\nMeasure peak", "**Status:** Decided\n\nMeasure peak");
    expect(() => parsePlanMarkdown(markdown)).toThrow("Knowledge Gap 1.A has invalid status `Decided`");
  });

  it("rejects resolved knowledge gaps with empty findings", () => {
    const plan = {
      ...samplePlan,
      components: [{
        ...samplePlan.components[0]!,
        knowledgeGaps: [{ ...samplePlan.components[0]!.knowledgeGaps[0]!, status: "Resolved" as const, findings: "" }],
      }],
    };
    expect(() => formatPlanMarkdown(plan)).toThrow("Resolved knowledge gaps must contain findings");
  });

  it("rejects documents without the component root", () => {
    expect(() => parsePlanMarkdown("---\ntitle: Invalid\n---\n\nNo components")).toThrow("missing required `# Components` heading");
  });

  it("rejects knowledge gaps without a findings subsection", () => {
    const markdown = formatPlanMarkdown(samplePlan).replace(/\n\n##### Findings[\s\S]*?(?=\n\n### \*\*Notes)/, "");
    expect(() => parsePlanMarkdown(markdown)).toThrow("missing required `##### Findings` subsection");
  });

  it("rejects findings as a peer of knowledge gaps", () => {
    const markdown = formatPlanMarkdown(samplePlan).replace("##### Findings", "#### Findings");
    expect(() => parsePlanMarkdown(markdown)).toThrow("missing required `##### Findings` subsection");
  });

  it("rejects separately headed finding items", () => {
    const markdown = formatPlanMarkdown(samplePlan).replace("Peak volume is 400 events per second.", "###### Finding 1.A\n\nPeak volume is 400 events per second.");
    expect(() => parsePlanMarkdown(markdown)).toThrow("Findings must be direct content under `##### Findings`");
  });

  it("rejects components missing a required section", () => {
    const markdown = formatPlanMarkdown(samplePlan).replace(/\n\n### \*\*Constraints\*\*[\s\S]*?(?=\n\n### \*\*Decisions)/, "");
    expect(() => parsePlanMarkdown(markdown)).toThrow("COMP-1 is missing required `### Constraints` subsection");
  });

  it("rejects component-level findings sections", () => {
    const markdown = formatPlanMarkdown(samplePlan).replace("### **Notes**", "### **Findings**\n\nUnsupported.\n\n### **Notes**");
    expect(() => parsePlanMarkdown(markdown)).toThrow("COMP-1 contains unsupported `### Findings` subsection");
  });

  it("rejects documents without the action-items root", () => {
    const markdown = formatPlanMarkdown({ ...samplePlan, actionItems: [] }).replace("\n# Action Items\n", "");
    expect(() => parsePlanMarkdown(markdown)).toThrow("missing required `# Action Items` heading");
  });

  it("rejects duplicate action-items roots", () => {
    const markdown = `${formatPlanMarkdown(samplePlan)}\n# Action Items\n`;
    expect(() => parsePlanMarkdown(markdown)).toThrow("document contains more than one `# Action Items` heading");
  });

  it("reports action-item trigger sources outside the plan", () => {
    const plan = {
      ...samplePlan,
      actionItems: [{
        ...samplePlan.actionItems[0]!,
        triggerSources: [{ ref: "Knowledge Gap 9.Z", title: "Missing gap" }],
      }],
    };
    const result = ingestPlanMarkdown(formatPlanMarkdown(plan));
    expect(result.validationFailures.ordering).toContainEqual({ section: "ACTION-1", failure: "Knowledge Gap 9.Z" });
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

  it("renumbers components and each subsection by document order without cascading replacements", () => {
    const component = samplePlan.components[0]!;
    const plan = {
      ...samplePlan,
      description: "Compare component 2 with COMP-4 and comp 5.",
      components: [
        { ...component, ref: "COMP-2", requirements: [{ ref: "2.A", title: "Requirement 2.A", details: "See requirement 4.A." }] },
        { ...component, ref: "COMP-4", requirements: [{ ref: "4.A", title: "Requirement 4.A", details: "See req 2.A." }] },
        { ...component, ref: "COMP-5", requirements: [{ ref: "5.A", title: "Requirement 5.A", details: "See R.2.A and requirements 4.A." }] },
      ],
      actionItems: [],
    };

    const result = ingestPlanMarkdown(formatPlanMarkdown(plan));

    expect(result.plan.components.map(({ ref }) => ref)).toEqual(["COMP-1", "COMP-2", "COMP-3"]);
    expect(result.plan.components.map(({ requirements }) => requirements[0]?.ref)).toEqual(["1.A", "2.A", "3.A"]);
    expect(result.plan.description).toBe("Compare component 1 with COMP-2 and comp 3.");
    expect(result.plan.components[0]?.requirements[0]?.details).toBe("See requirement 2.A.");
    expect(result.plan.components[1]?.requirements[0]?.details).toBe("See req 1.A.");
    expect(result.plan.components[2]?.requirements[0]?.details).toBe("See R.1.A and requirements 2.A.");
    expect(result.validationFailures.ordering).toEqual([]);
  });

  it("rewrites aliases across all text-bearing plan fields", () => {
    const component = samplePlan.components[0]!;
    const plan = {
      ...samplePlan,
      title: "Requirement 7.A",
      description: "constraint 7.A",
      tags: ["note 7.A"],
      components: [{
        ...component,
        ref: "COMP-7",
        title: "Decision 7.A",
        description: "finding 7.A",
        requirements: [{ ref: "7.A", title: "Req 7.A", details: "R.7.A" }],
        constraints: [{ ref: "7.A", title: "Cons 7.A", details: "C 7.A" }],
        decisions: [{ ref: "7.A", title: "Dec 7.A", status: "Open" as const, details: "D.7.A" }],
        knowledgeGaps: [{ ref: "7.A", title: "Knowledge gap 7.A", status: "Open" as const, details: "KG 7.A", findings: "findings 7.A" }],
        notes: [{ ref: "7.A", title: "Notes 7.A", details: "N 7.A" }],
        questions: [{ ref: "7.A", title: "Question 7.A", details: "Q.7.A" }],
      }],
      actionItems: [{
        ...samplePlan.actionItems[0]!,
        title: "COMP-7",
        context: "requirement 7.A",
        acceptanceCriteria: [{ ref: "1.A", title: "Acceptance Criteria 1.A", details: "notes 7.A" }],
        triggerSources: [{ ref: "Knowledge Gap 7.A", title: "finding 7.A" }],
        assignees: ["Owner of req 7.A"],
      }],
    };

    const result = ingestPlanMarkdown(formatPlanMarkdown(plan));
    expect(JSON.stringify(result.plan)).not.toMatch(/7\.A|COMP-7/i);
    expect(result.plan.components[0]?.knowledgeGaps[0]?.findings).toBe("findings 1.A");
    expect(result.plan.actionItems[0]?.triggerSources[0]?.ref).toBe("Knowledge Gap 1.A");
    expect(result.validationFailures.ordering).toEqual([]);
  });

  it("sequences subsection labels beyond Z using dotted letters", () => {
    const requirements = Array.from({ length: 54 }, (_, index) => ({
      ref: `9.${String.fromCharCode(65 + (index % 26))}`,
      title: `Item ${index + 1}`,
      details: "",
    }));
    const plan = {
      ...samplePlan,
      components: [{ ...samplePlan.components[0]!, ref: "COMP-9", requirements }],
      actionItems: [],
    };

    const parsed = parsePlanMarkdown(formatPlanMarkdown(plan));
    expect(parsed.components[0]?.requirements.map(({ ref }) => ref).slice(24)).toEqual([
      "1.Y", "1.Z", "1.A.A", "1.A.B", "1.A.C", "1.A.D", "1.A.E", "1.A.F", "1.A.G", "1.A.H",
      "1.A.I", "1.A.J", "1.A.K", "1.A.L", "1.A.M", "1.A.N", "1.A.O", "1.A.P", "1.A.Q", "1.A.R",
      "1.A.S", "1.A.T", "1.A.U", "1.A.V", "1.A.W", "1.A.X", "1.A.Y", "1.A.Z", "1.B.A", "1.B.B",
    ]);
  });

  it("leaves unknown references unchanged and reports their updated containing section", () => {
    const plan = {
      ...samplePlan,
      components: [{
        ...samplePlan.components[0]!,
        ref: "COMP-2",
        requirements: [{ ref: "2.A", title: "Requirement 2.A", details: "See also potato 3.B and req 9.Z." }],
      }],
      actionItems: [],
    };

    const result = ingestPlanMarkdown(formatPlanMarkdown(plan));
    expect(result.plan.components[0]?.requirements[0]?.details).toBe("See also potato 3.B and req 9.Z.");
    expect(result.validationFailures.ordering).toEqual([
      { section: "Requirement 1.A", failure: "potato 3.B" },
      { section: "Requirement 1.A", failure: "req 9.Z" },
    ]);
  });

  it("supports component aliases without rewriting malformed near-matches", () => {
    const plan = {
      ...samplePlan,
      description: "component-7, comp. 7, component #7; not COMP-7A or component 7.3.",
      components: [{ ...samplePlan.components[0]!, ref: "COMP-7" }],
      actionItems: [],
    };

    const result = ingestPlanMarkdown(formatPlanMarkdown(plan));
    expect(result.plan.description).toBe("component-1, comp. 1, component #1; not COMP-7A or component 7.3.");
  });
});
