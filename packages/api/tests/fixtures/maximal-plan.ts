import type { Plan } from "../../src/plans/domain.js";

/**
 * A deliberately maximal plan used to pin encoder/decoder behavior during the
 * model refactor. It is already in canonical normalized form so that
 * `parse(format(plan))` is an identity round trip.
 *
 * Coverage targets:
 * - two components, so component renumbering and `<component>.<letters>` refs are exercised
 * - every component section populated, with more than one item in several of them
 * - every allowed status value for decisions, knowledge gaps, and action items; the plan
 *   frontmatter here uses `In Progress`, while the sample-plan fixture exercises `Draft`
 * - fenced code blocks, inline code, bold/italic, nested lists, tables, and blockquotes
 *   inside item details, so raw-source extraction is pinned
 * - non-ASCII text in titles and details, so byte-offset slicing is exercised across
 *   multi-byte characters
 * - a fenced code block containing text that looks like a plan heading
 * - resolved and open knowledge gaps, including multi-paragraph findings
 * - canonical cross references in prose that normalization rewrites to themselves
 * - multiple action items with multiple acceptance criteria, trigger sources, and assignees
 */
export const maximalPlan: Plan = {
  reference: "PLAN-00000000-0000-4000-8000-000000000000",
  title: "Maximal characterization plan",
  description: "Exercises every section, status, and Markdown construct the codec supports.",
  tags: ["characterization", "round-trip", "COMP-1"],
  status: "In Progress",
  components: [
    {
      ref: "COMP-1",
      title: "Ingestion pipeline",
      description: "Covers how source documents reach the store.\n\nSee COMP-2 for the retrieval half.",
      requirements: [
        {
          ref: "1.A",
          title: "Requirement 1.A",
          details: "Uploads must accept `text/markdown` and `text/plain` bodies. Accented text (café, naïve) and CJK (数据) survive byte-offset slicing.",
        },
        {
          ref: "1.B",
          title: "Accept fenced code in details",
          details: [
            "Details may contain fenced code, including text that resembles plan headings:",
            "",
            "```markdown",
            "#### Requirement 9.Z - not a real heading",
            "### **Requirements**",
            "## **COMP-99 - decoy**",
            "```",
            "",
            "The fence above must survive a full round trip unchanged.",
          ].join("\n"),
        },
        {
          ref: "1.C",
          title: "Support rich prose",
          details: [
            "Requirement 1.A is the baseline. This item adds **bold**, _italic_, and `code`.",
            "",
            "- first bullet",
            "  - nested bullet",
            "- second bullet",
            "",
            "| Column | Meaning |",
            "|---|---|",
            "| a | first |",
            "| b | second |",
          ].join("\n"),
        },
      ],
      constraints: [
        {
          ref: "1.A",
          title: "Constraint 1.A",
          details: "Writes for a plan must remain transactional.",
        },
        {
          ref: "1.B",
          title: "Preserve existing behavior",
          details: "No regression failures are permitted, per Constraint 1.A.",
        },
      ],
      decisions: [
        {
          ref: "1.A",
          title: "Decision 1.A",
          status: "Open",
          details: "Choose between batch and streaming ingestion.",
        },
        {
          ref: "1.B",
          title: "Parse with an AST library",
          status: "Decided",
          details: "Selected alternative: mdast. Rejected alternative: regular expressions over the whole document.",
        },
        {
          ref: "1.C",
          title: "Defer queue tuning",
          status: "Closed",
          details: "Superseded by Decision 1.B.",
        },
      ],
      knowledgeGaps: [
        {
          ref: "1.A",
          title: "Knowledge Gap 1.A",
          status: "Open",
          details: "Measure peak event volume.",
          findings: "",
        },
        {
          ref: "1.B",
          title: "Confirm the storage boundary",
          status: "Resolved",
          details: "The persistence layer was a black box.",
          findings: [
            "The repository owns every direct database access (including UTF-8 identifiers such as données and 存储).",
            "",
            "Findings may span multiple paragraphs and contain `inline code`, and may reference Requirement 1.A.",
          ].join("\n"),
        },
        {
          ref: "1.C",
          title: "Abandoned investigation",
          status: "Closed",
          details: "No longer relevant after Decision 1.C.",
          findings: "",
        },
      ],
      notes: [
        {
          ref: "1.A",
          title: "Note 1.A",
          details: "The current export is CSV and Finance reviews reports monthly.",
        },
      ],
      questions: [
        {
          ref: "1.A",
          title: "Question 1.A",
          details: "Regarding monthly reviews, which timezone defines month end?",
        },
        {
          ref: "1.B",
          title: "Clarify retention",
          details: "Does Constraint 1.A imply a hard delete after thirty days?",
        },
      ],
    },
    {
      ref: "COMP-2",
      title: "Retrieval surface",
      description: "Covers how stored plans are read back.",
      requirements: [
        {
          ref: "2.A",
          title: "Requirement 2.A",
          details: "Canonical downloads must contain the persisted reference.",
        },
      ],
      constraints: [
        {
          ref: "2.A",
          title: "Constraint 2.A",
          details: "Downloads must remain atomic.",
        },
      ],
      decisions: [
        {
          ref: "2.A",
          title: "Decision 2.A",
          status: "Decided",
          details: "Serve both JSON and Markdown representations.",
        },
      ],
      knowledgeGaps: [
        {
          ref: "2.A",
          title: "Knowledge Gap 2.A",
          status: "Open",
          details: "Unknown whether pagination is required.",
          findings: "",
        },
      ],
      notes: [
        {
          ref: "2.A",
          title: "Note 2.A",
          details: "Retrieval mirrors the ingest conventions described in COMP-1.",
        },
      ],
      questions: [
        {
          ref: "2.A",
          title: "Question 2.A",
          details: "Should Knowledge Gap 2.A block the release?",
        },
      ],
    },
  ],
  actionItems: [
    {
      ref: "ACTION-1",
      title: "Validate peak capacity",
      status: "TODO",
      context: "Validate whether the platform can handle the measured peak described in Knowledge Gap 1.A.",
      acceptanceCriteria: [
        {
          ref: "A",
          title: "Acceptance Criteria A",
          details: "Document the supported peak event rate.",
        },
        {
          ref: "B",
          title: "Record the measurement method",
          details: "Include the tooling and the sampling window.",
        },
      ],
      triggerSources: [
        { ref: "COMP-1", title: "Ingestion pipeline" },
        { ref: "Knowledge Gap 1.A", title: "Measure peak event volume" },
      ],
      assignees: ["Data team", "Platform team"],
    },
    {
      ref: "ACTION-2",
      title: "Publish the retrieval contract",
      status: "In Progress",
      context: "Write down the response shapes for the retrieval routes.",
      acceptanceCriteria: [
        {
          ref: "A",
          title: "Acceptance Criteria A",
          details: "Both representations are documented.",
        },
      ],
      triggerSources: [{ ref: "COMP-2", title: "Retrieval surface" }],
      assignees: ["Docs team"],
    },
    {
      ref: "ACTION-3",
      title: "Close out the migration",
      status: "Done",
      context: "Finished ahead of Decision 2.A.",
      acceptanceCriteria: [],
      triggerSources: [],
      assignees: [],
    },
    {
      ref: "ACTION-4",
      title: "Cancelled cleanup",
      status: "Closed",
      context: "Dropped from scope.",
      acceptanceCriteria: [],
      triggerSources: [],
      assignees: [],
    },
  ],
};
