import type { Plan } from "../../src/domain.js";

export const samplePlan: Plan = {
  reference: "New",
  title: "Analytics refresh",
  description: "Plan the analytics refresh.",
  tags: ["analytics", "planning"],
  status: "Draft",
  components: [{
    ref: "COMP-1",
    title: "Data management strategy",
    description: "Define how analytics data should be managed.",
    requirements: [{ ref: "1.A", title: "Requirement 1.A", details: "Users must export reports." }],
    constraints: [{ ref: "1.A", title: "Constraint 1.A", details: "The platform stores data for 30 days." }],
    decisions: [{ ref: "1.A", title: "Decision 1.A", status: "Open", details: "Choose batch or streaming ingestion." }],
    knowledgeGaps: [{ ref: "1.A", title: "Knowledge Gap 1.A", status: "Open", details: "Measure peak event volume." }],
    findings: [{ ref: "1.A", title: "Finding 1.A", details: "The current export is CSV." }],
    notes: [{ ref: "1.A", title: "Note 1.A", details: "Finance reviews reports monthly." }],
    questions: [{ ref: "1.A", title: "Question 1.A", details: "Regarding monthly reviews, which timezone defines month end?" }],
  }],
};
