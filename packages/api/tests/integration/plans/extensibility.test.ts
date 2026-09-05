import { afterEach, describe, expect, it } from "vitest";
import { componentItemSections, componentSchema } from "../../../src/plans/models/component.js";
import { formatPlanMarkdown, parsePlanMarkdown } from "../../../src/plans/markdown.js";
import { applyPlanPatch, parsePlanPatchMarkdown } from "../../../src/plans/patch.js";
import { PlanRepository } from "../../../src/plans/repository.js";
import { textSection } from "../../../src/plans/models/textItem.js";
import { z } from "zod";

/**
 * Proves the extensibility claim behind the refactor: adding a component subsection is
 * one section descriptor plus its schema field. Parsing, formatting, patching,
 * normalization, and persistence all pick it up with no further edits.
 *
 * The section is added to the live registry inside this test process (a testing technique;
 * there is no runtime registration feature) and removed afterwards so the rest of the
 * suite sees the real registry.
 */
const risksSection = textSection({
  key: "risks",
  heading: "Risks",
  singularLabel: "Risk",
  aliases: ["risks?", "rsk"],
  dbKind: "risk",
});

function register(): void {
  componentItemSections.push(risksSection as unknown as typeof componentItemSections[number]);
  (componentSchema.shape as Record<string, unknown>).risks = z.array(
    z.object({ ref: z.string().min(1), title: z.string().min(1), details: z.string() }),
  );
}

function unregister(): void {
  const index = componentItemSections.indexOf(risksSection as unknown as typeof componentItemSections[number]);
  if (index !== -1) componentItemSections.splice(index, 1);
  delete (componentSchema.shape as Record<string, unknown>).risks;
}

const document = (risks: string): string => [
  "---",
  "reference: PLAN-extensibility",
  "title: Extensibility probe",
  "description: ''",
  "tags: []",
  "status: Draft",
  "---",
  "",
  "# Components",
  "",
  "| Ref | Short Description |",
  "|---|---|",
  "| COMP-1 | Only component |",
  "",
  "## **COMP-1 - Only component**",
  "",
  "Description.",
  "",
  "### **Requirements**",
  "",
  "### **Constraints**",
  "",
  "### **Decisions**",
  "",
  "### **Knowledge Gaps**",
  "",
  "### **Notes**",
  "",
  "### **Open Questions**",
  "",
  "### **Risks**",
  "",
  risks,
  "",
  "# Action Items",
  "",
].join("\n");

describe("adding a section requires only a descriptor", () => {
  afterEach(unregister);

  it("is rejected as an unsupported subsection before registration", () => {
    expect(() => parsePlanMarkdown(document("#### Risk 1.A - Data loss\n\nBody."))).toThrow(
      "COMP-1 contains unsupported `### Risks` subsection.",
    );
  });

  it("parses, renumbers, formats, and round-trips once registered", () => {
    register();
    const plan = parsePlanMarkdown(document("#### Risk 9.Q - Data loss\n\nBody.\n\n#### Risk 9.R - Latency\n\nOther."));
    const risks = (plan.components[0] as unknown as Record<string, Array<{ ref: string; title: string }>>).risks!;
    expect(risks.map((risk) => risk.ref)).toEqual(["1.A", "1.B"]);
    expect(risks[0]!.title).toBe("Data loss");

    const markdown = formatPlanMarkdown(plan);
    expect(markdown).toContain("### **Risks**");
    expect(markdown).toContain("#### Risk 1.A - Data loss");
    expect(parsePlanMarkdown(markdown)).toEqual(plan);
  });

  it("rewrites prose references to the new section through its aliases", () => {
    register();
    const plan = parsePlanMarkdown(document(
      "#### Risk 9.Q - Data loss\n\nSee rsk 9.R.\n\n#### Risk 9.R - Latency\n\nOther.",
    ));
    const risks = (plan.components[0] as unknown as Record<string, Array<{ details: string }>>).risks!;
    expect(risks[0]!.details).toBe("See rsk 1.B.");
  });

  it("accepts patch operations against the new section", () => {
    register();
    const existing = parsePlanMarkdown(document("#### Risk 1.A - Data loss\n\nBody."));
    const { plan } = applyPlanPatch(existing, parsePlanPatchMarkdown([
      "---",
      "reference: PLAN-extensibility",
      "---",
      "",
      "## **COMP-1 - Only component**",
      "",
      "### **Risks**",
      "",
      "#### Risk New - Added by patch",
      "",
      "**Handle:** r1",
      "",
      "Patch body.",
    ].join("\n")));
    const risks = (plan.components[0] as unknown as Record<string, Array<{ ref: string; title: string }>>).risks!;
    expect(risks.map((risk) => risk.title)).toEqual(["Data loss", "Added by patch"]);
    expect(risks[1]!.ref).toBe("1.B");
  });

  it("persists and reloads the new section without touching the repository", () => {
    register();
    const repository = new PlanRepository(":memory:");
    try {
      const plan = parsePlanMarkdown(document("#### Risk 1.A - Data loss\n\nBody."));
      const reference = repository.save(plan);
      expect(repository.get(reference)).toEqual(plan);
      const kinds = repository.database
        .prepare("SELECT DISTINCT kind FROM items")
        .all() as unknown as Array<{ kind: string }>;
      expect(kinds.map((row) => row.kind)).toContain("risk");
    } finally {
      repository.close();
    }
  });
});
