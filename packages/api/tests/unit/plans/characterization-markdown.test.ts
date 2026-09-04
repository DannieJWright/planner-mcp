import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatPlanMarkdown, ingestPlanMarkdown, parsePlanMarkdown } from "../../../src/plans/markdown.js";
import { maximalPlan } from "../../fixtures/maximal-plan.js";

const goldenPath = fileURLToPath(new URL("../../fixtures/maximal-plan.md", import.meta.url));
const golden = readFileSync(goldenPath, "utf8");

/**
 * Characterization tests. These pin the current encoder/decoder behavior byte for byte
 * so the model refactor can be verified to preserve it. They intentionally lock in
 * present-day quirks; where a quirk is locked in deliberately it is called out in the
 * test name so a future intentional change is an obvious, reviewed diff.
 */
describe("characterization: canonical Markdown encoding", () => {
  it("encodes the maximal plan byte for byte", () => {
    expect(formatPlanMarkdown(maximalPlan)).toBe(golden);
  });

  it("decodes the golden document back to the maximal plan", () => {
    expect(parsePlanMarkdown(golden)).toEqual(maximalPlan);
  });

  it("is idempotent across a second round trip", () => {
    expect(formatPlanMarkdown(parsePlanMarkdown(golden))).toBe(golden);
  });

  it("preserves fenced code containing decoy plan headings", () => {
    const requirement = parsePlanMarkdown(golden).components[0]!.requirements[1]!;
    expect(requirement.details).toContain("```markdown");
    expect(requirement.details).toContain("#### Requirement 9.Z - not a real heading");
    expect(requirement.details).toContain("## **COMP-99 - decoy**");
  });

  it("preserves nested lists, tables, and inline formatting in details", () => {
    const requirement = parsePlanMarkdown(golden).components[0]!.requirements[2]!;
    expect(requirement.details).toContain("  - nested bullet");
    expect(requirement.details).toContain("| a | first |");
    expect(requirement.details).toContain("**bold**, _italic_, and `code`");
  });

  it("preserves multi-paragraph findings", () => {
    const gap = parsePlanMarkdown(golden).components[0]!.knowledgeGaps[1]!;
    expect(gap.findings).toBe(
      "The repository owns every direct database access (including UTF-8 identifiers such as données and 存储).\n\nFindings may span multiple paragraphs and contain `inline code`, and may reference Requirement 1.A.",
    );
  });

  it("emits an empty Findings subsection for gaps without findings (quirk)", () => {
    expect(golden).toContain("Measure peak event volume.\n\n##### Findings\n\n#### Knowledge Gap 1.B");
  });

  it("emits blank bodies for empty action subsections (quirk)", () => {
    expect(golden).toContain("### Acceptance Criteria\n\n\n\n### Trigger Sources\n\n\n\n### Assignees");
  });

  it("strips exactly one blockquote marker from question details", () => {
    const questions = parsePlanMarkdown(golden).components[0]!.questions;
    expect(questions[0]!.details).toBe("Regarding monthly reviews, which timezone defines month end?");
    expect(golden).toContain("> Regarding monthly reviews, which timezone defines month end?");
  });
});

describe("characterization: reference normalization", () => {
  it("reports unresolved references found inside fenced code (quirk)", () => {
    expect(ingestPlanMarkdown(golden).validationFailures.ordering).toEqual([
      { section: "Requirement 1.B", failure: "Requirement 9.Z" },
      { section: "Requirement 1.B", failure: "COMP-99" },
    ]);
  });

  it("renumbers components and items by document order", () => {
    const source = golden
      .replace("## **COMP-1 - Ingestion pipeline**", "## **COMP-7 - Ingestion pipeline**")
      .replace("| COMP-1 | Ingestion pipeline |", "| COMP-7 | Ingestion pipeline |")
      .replace("## **COMP-2 - Retrieval surface**", "## **COMP-4 - Retrieval surface**")
      .replace("| COMP-2 | Retrieval surface |", "| COMP-4 | Retrieval surface |");
    const plan = parsePlanMarkdown(source);
    expect(plan.components.map((component) => component.ref)).toEqual(["COMP-1", "COMP-2"]);
  });

  it("rewrites cross references in prose when a component is renumbered", () => {
    const source = golden
      .replace("## **COMP-1 - Ingestion pipeline**", "## **COMP-7 - Ingestion pipeline**")
      .replace("| COMP-1 | Ingestion pipeline |", "| COMP-7 | Ingestion pipeline |")
      .replace("described in COMP-1.", "described in COMP-7.");
    const plan = parsePlanMarkdown(source);
    expect(plan.components[1]!.notes[0]!.details).toBe("Retrieval mirrors the ingest conventions described in COMP-1.");
  });

  it("rewrites item references through aliases when the target is renumbered", () => {
    const source = golden
      .replace("#### Requirement 1.C - Support rich prose", "#### Requirement 1.Q - Support rich prose")
      .replace(
        "No regression failures are permitted, per Constraint 1.A.",
        "No regression failures are permitted, per c 1.A, Req 1.Q, and k.g. 1.B.",
      );
    const plan = parsePlanMarkdown(source);
    expect(plan.components[0]!.constraints[1]!.details).toBe(
      "No regression failures are permitted, per c 1.A, Req 1.C, and k.g. 1.B.",
    );
  });

  it("assigns multi-letter subsection labels beyond twenty-six items", () => {
    const extra = Array.from({ length: 27 }, (_, index) => `#### Note 1.${index} - Generated ${index}\n\nBody ${index}.`).join("\n\n");
    const source = golden.replace(
      "#### Note 1.A\n\nThe current export is CSV and Finance reviews reports monthly.",
      extra,
    );
    const refs = parsePlanMarkdown(source).components[0]!.notes.map((note) => note.ref);
    expect(refs[0]).toBe("1.A");
    expect(refs[25]).toBe("1.Z");
    expect(refs[26]).toBe("1.A.A");
  });
});

describe("characterization: rejected documents", () => {
  const cases: Array<{ name: string; mutate: (source: string) => string; message: string }> = [
    {
      name: "missing the Components heading",
      mutate: (source) => source.replace("# Components\n", "# Parts\n"),
      message: "Plan Markdown error: missing required `# Components` heading.",
    },
    {
      name: "missing the Action Items heading",
      mutate: (source) => source.replace("# Action Items\n", "# Tasks\n"),
      message: "Plan Markdown error: missing required `# Action Items` heading.",
    },
    {
      name: "duplicate Components headings",
      mutate: (source) => `${source}\n# Components\n`,
      message: "Plan Markdown error: document contains more than one `# Components` heading.",
    },
    {
      name: "Action Items before Components",
      mutate: (source) => source.replace("# Components\n", "# Action Items\n").replace(/\n# Action Items\n\n## \*\*ACTION-1/, "\n# Components\n\n## **ACTION-1"),
      message: "Plan Markdown error: `# Action Items` must appear after `# Components`.",
    },
    {
      name: "unsupported component subsection",
      mutate: (source) => source.replace("### **Notes**\n\n#### Note 1.A", "### **Remarks**\n\n#### Note 1.A"),
      message: "COMP-1 contains unsupported `### Remarks` subsection.",
    },
    {
      name: "duplicate component subsection",
      mutate: (source) => source.replace("### **Notes**\n\n#### Note 1.A", "### **Constraints**\n\n#### Note 1.A"),
      message: "COMP-1 contains duplicate `### Constraints` subsections.",
    },
    {
      name: "missing component subsection",
      mutate: (source) => source.replace("### **Notes**\n\n#### Note 1.A\n\nThe current export is CSV and Finance reviews reports monthly.\n\n", ""),
      message: "COMP-1 is missing required `### Notes` subsection.",
    },
    {
      name: "invalid item heading",
      mutate: (source) => source.replace("#### Note 1.A", "#### Remark 1.A"),
      message: "invalid item heading `Remark 1.A`. Expected `#### <Item Type> <reference> - <title>`, for example `#### Requirement 1.A - Upload plans`.",
    },
    {
      name: "decision without a status",
      mutate: (source) => source.replace("#### Decision 1.A\n\n**Status:** Open\n\n", "#### Decision 1.A\n\n"),
      message: "Decision 1.A has missing required status. Add `**Status:** Open` immediately below the heading; allowed values are Open, Decided, Closed.",
    },
    {
      name: "decision with a knowledge-gap status",
      mutate: (source) => source.replace("#### Decision 1.A\n\n**Status:** Open", "#### Decision 1.A\n\n**Status:** Resolved"),
      message: "Decision 1.A has invalid status `Resolved`",
    },
    {
      name: "knowledge gap missing the Findings subsection",
      mutate: (source) => source.replace("Measure peak event volume.\n\n##### Findings\n", "Measure peak event volume.\n"),
      message: "Knowledge Gap 1.A is missing required `##### Findings` subsection.",
    },
    {
      name: "knowledge gap with two Findings subsections",
      mutate: (source) => source.replace("Measure peak event volume.\n\n##### Findings\n", "Measure peak event volume.\n\n##### Findings\n\n##### Findings\n"),
      message: "Knowledge Gap 1.A contains more than one `##### Findings` subsection.",
    },
    {
      // Nested-subsection errors must name the item by its full heading text (label, ref, and any
      // custom title), not just label plus ref. Pinned deliberately.
      name: "titled knowledge gap missing the Findings subsection",
      mutate: (source) => source.replace("#### Knowledge Gap 1.A\n", "#### Knowledge Gap 1.A - Persistence mystery\n").replace("Measure peak event volume.\n\n##### Findings\n", "Measure peak event volume.\n"),
      message: "Knowledge Gap 1.A - Persistence mystery is missing required `##### Findings` subsection.",
    },
    {
      // See the titled-missing-Findings case above.
      name: "titled knowledge gap with two Findings subsections",
      mutate: (source) => source.replace("#### Knowledge Gap 1.A\n", "#### Knowledge Gap 1.A - Persistence mystery\n").replace("Measure peak event volume.\n\n##### Findings\n", "Measure peak event volume.\n\n##### Findings\n\n##### Findings\n"),
      message: "Knowledge Gap 1.A - Persistence mystery contains more than one `##### Findings` subsection.",
    },
    {
      name: "knowledge gap section with an invalid stray item heading",
      mutate: (source) => source.replace(
        "The persistence layer was a black box.\n\n##### Findings",
        "The persistence layer was a black box.\n\n#### Random stuff\n\nLost content.\n\n##### Findings",
      ),
      message: "invalid item heading `Random stuff`. Expected `#### <Item Type> <reference> - <title>`, for example `#### Requirement 1.A - Upload plans`.",
    },
    {
      name: "knowledge gap with a nested Finding heading",
      mutate: (source) => source.replace("##### Findings\n\nThe repository owns", "##### Findings\n\n#### Finding 1.A - nested\n\nThe repository owns"),
      message: "Findings must be direct content under `##### Findings`; remove the separate `Finding 1.A - nested` heading.",
    },
    {
      name: "resolved knowledge gap with empty findings",
      mutate: (source) => source.replace("#### Knowledge Gap 1.A\n\n**Status:** Open", "#### Knowledge Gap 1.A\n\n**Status:** Resolved"),
      message: "Knowledge Gap 1.A cannot be `Resolved` with empty Findings.",
    },
    {
      name: "action item missing a subsection",
      mutate: (source) => source.replace("### Assignees\n\n- Data team\n- Platform team\n\n", ""),
      message: "ACTION-1 is missing required `### Assignees` subsection.",
    },
    {
      // The unified parser rejects unknown and duplicated action-item subsections in strict
      // mode; the pre-refactor strict parser silently ignored them. Pinned deliberately.
      name: "unsupported action item subsection",
      mutate: (source) => source.replace("### Acceptance Criteria\n", "### Nonsense\n"),
      message: "ACTION-1 contains unsupported `### Nonsense` subsection.",
    },
    {
      // See the unsupported-subsection case above.
      name: "duplicate action item subsection",
      mutate: (source) => source.replace("### Assignees\n", "### Assignees\n\n### Assignees\n"),
      message: "ACTION-1 contains duplicate `### Assignees` subsections.",
    },
    {
      // Action-item status errors are now generated from the descriptor, so they read
      // the same as every other status error instead of enumerating values inline.
      name: "action item with an invalid status",
      mutate: (source) => source.replace("## **ACTION-1 - Validate peak capacity**\n\n**Status:** TODO", "## **ACTION-1 - Validate peak capacity**\n\n**Status:** Pending"),
      message: "ACTION-1 has invalid status `Pending`. Add `**Status:** TODO` immediately below the heading; allowed values are TODO, In Progress, Done, Closed.",
    },
    {
      name: "malformed trigger source",
      mutate: (source) => source.replace("- COMP-1 - Ingestion pipeline", "- COMP-1"),
      message: "invalid trigger source `COMP-1`. Expected `- <reference> - <short description>`.",
    },
    {
      name: "missing frontmatter title",
      mutate: (source) => source.replace("title: Maximal characterization plan\n", ""),
      message: "Plan Markdown error: invalid or missing document fields:",
    },
    {
      name: "invalid frontmatter status",
      mutate: (source) => source.replace("status: In Progress", "status: Pending"),
      message: "Plan Markdown error: invalid or missing document fields:",
    },
  ];

  for (const { name, mutate, message } of cases) {
    it(`rejects a document ${name}`, () => {
      expect(() => parsePlanMarkdown(mutate(golden))).toThrow(message);
    });
  }
});

describe("characterization: silently tolerated input (quirks)", () => {
  it("silently drops a component heading that omits the ` - ` separator", () => {
    const source = golden.replace("## **COMP-1 - Ingestion pipeline**", "## **COMP-1 Ingestion pipeline**");
    const plan = parsePlanMarkdown(source);
    expect(plan.components).toHaveLength(1);
    expect(plan.components[0]!.title).toBe("Retrieval surface");
  });

  it("silently drops an action item heading that omits the ` - ` separator", () => {
    const source = golden.replace("## **ACTION-1 - Validate peak capacity**", "## **ACTION-1 Validate peak capacity**");
    const plan = parsePlanMarkdown(source);
    expect(plan.actionItems.map((action) => action.title)).toEqual([
      "Publish the retrieval contract",
      "Close out the migration",
      "Cancelled cleanup",
    ]);
  });

  it("accepts a component heading spelled COMPONENT in prose references (quirk)", () => {
    const source = golden.replace("described in COMP-1.", "described in COMPONENT 1.");
    expect(parsePlanMarkdown(source).components[1]!.notes[0]!.details).toBe(
      "Retrieval mirrors the ingest conventions described in COMPONENT 1.",
    );
  });

  it("accepts an unbolded status line", () => {
    const source = golden.replace("#### Decision 1.A\n\n**Status:** Open", "#### Decision 1.A\n\nStatus: Open");
    expect(parsePlanMarkdown(source).components[0]!.decisions[0]!.status).toBe("Open");
  });
});

describe("item boundary rules", () => {
  it("accepts any item label inside a section without nested subsections", () => {
    const source = golden.replace(
      "#### Requirement 1.A\n\nUploads must accept",
      "#### Note 1.A - Borrowed label\n\nBody.\n\n#### Requirement 1.B\n\nUploads must accept",
    );
    const requirements = parsePlanMarkdown(source).components[0]!.requirements;
    expect(requirements).toHaveLength(4);
    expect(requirements[0]!.title).toBe("Borrowed label");
  });

  it("does not let a foreign item heading split a knowledge gap from its Findings", () => {
    // Knowledge gaps own a nested `##### Findings` subsection, so their item boundaries
    // are found by label. A stray same-depth heading must not truncate the gap.
    const source = golden.replace(
      "The persistence layer was a black box.\n\n##### Findings",
      "The persistence layer was a black box.\n\n#### Note 9.Z - stray\n\n##### Findings",
    );
    const gap = parsePlanMarkdown(source).components[0]!.knowledgeGaps[1]!;
    expect(gap.status).toBe("Resolved");
    expect(gap.findings).toContain("The repository owns every direct database access (including UTF-8 identifiers such as données and 存储).");
  });

  it("still rejects a nested Finding item heading inside the Findings prose", () => {
    const source = golden.replace(
      "##### Findings\n\nThe repository owns",
      "##### Findings\n\n###### Finding 1.A - nested\n\nThe repository owns",
    );
    expect(() => parsePlanMarkdown(source)).toThrow(
      "Findings must be direct content under `##### Findings`; remove the separate `Finding 1.A - nested` heading.",
    );
  });
});
