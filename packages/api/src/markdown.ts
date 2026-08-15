import matter from "gray-matter";
import { fromMarkdown } from "mdast-util-from-markdown";
import YAML from "yaml";
import { decisionStatuses, knowledgeGapStatuses, planSchema, type ActionItem, type Component, type KnowledgeGap, type Plan, type StatusItem, type TextItem } from "./domain.js";

type Node = {
  type: string;
  depth?: number;
  value?: string;
  children?: Node[];
  position?: {
    start: { line?: number; offset?: number };
    end: { offset?: number };
  };
};

const sections = [
  "Requirements",
  "Constraints",
  "Decisions",
  "Knowledge Gaps",
  "Notes",
  "Open Questions",
] as const;

type ComponentItemKey = "requirements" | "constraints" | "decisions" | "knowledgeGaps" | "notes" | "questions";

const referenceTypes: Array<{
  key: ComponentItemKey;
  label: string;
  aliases: string[];
}> = [
  { key: "requirements", label: "Requirement", aliases: ["requirements?", "reqs?", "r"] },
  { key: "constraints", label: "Constraint", aliases: ["constraints?", "cons?", "c"] },
  { key: "decisions", label: "Decision", aliases: ["decisions?", "decs?", "d"] },
  { key: "knowledgeGaps", label: "Knowledge Gap", aliases: ["knowledge\\s+gaps?", "k\\.?g\\.?", "findings?", "f"] },
  { key: "notes", label: "Note", aliases: ["notes?", "n"] },
  { key: "questions", label: "Question", aliases: ["(?:open\\s+)?questions?", "qs?", "q"] },
];

export type OrderingValidationFailure = {
  section: string;
  failure: string;
};

export type PlanValidationFailures = {
  ordering: OrderingValidationFailure[];
};

export type PlanIngestResult = {
  plan: Plan;
  validationFailures: PlanValidationFailures;
};

function subsectionLabel(index: number): string {
  let length = 1;
  let offset = index;
  let blockSize = 26;
  while (offset >= blockSize) {
    offset -= blockSize;
    length += 1;
    blockSize *= 26;
  }
  const letters = Array<string>(length);
  for (let position = length - 1; position >= 0; position -= 1) {
    letters[position] = String.fromCharCode(65 + (offset % 26));
    offset = Math.floor(offset / 26);
  }
  return letters.join(".");
}

function referenceKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizePlan(plan: Plan): PlanIngestResult {
  const mappings = new Map<string, string>();
  const componentNumbers = new Map<string, string>();

  plan.components.forEach((component, componentIndex) => {
    const componentNumber = componentIndex + 1;
    const newComponentRef = `COMP-${componentNumber}`;
    const oldNumber = component.ref.slice("COMP-".length);
    componentNumbers.set(oldNumber, String(componentNumber));
    component.ref = newComponentRef;

    for (const type of referenceTypes) {
      component[type.key].forEach((item, itemIndex) => {
        const oldRef = item.ref;
        const newRef = `${componentNumber}.${subsectionLabel(itemIndex)}`;
        mappings.set(`${type.key}:${referenceKey(oldRef)}`, newRef);
        item.ref = newRef;
      });
    }
  });

  const componentPattern = /\b(COMP(?:ONENT)?S?)(\s*(?:[-.#]\s*|\s+))(\d+)(?![\w]|\.\d)/gi;
  const typedPatterns = referenceTypes.map((type) => ({
    ...type,
    pattern: new RegExp(`\\b(${type.aliases.join("|")})(\\s+|\\.\\s*)(\\d+(?:\\.[A-Za-z]+)+)`, "gi"),
  }));
  const genericPattern = /\b([A-Za-z][A-Za-z.]*)(\s+)(\d+(?:\.[A-Za-z]+)+)/g;
  const failures: OrderingValidationFailure[] = [];

  const rewrite = (value: string, section: string): string => {
    const unresolved: Array<{ start: number; end: number; failure: string }> = [];
    let rewritten = value.replace(componentPattern, (match, label: string, separator: string, number: string, offset: number) => {
      const replacement = componentNumbers.get(number);
      if (replacement) return `${label}${separator}${replacement}`;
      unresolved.push({ start: offset, end: offset + match.length, failure: match });
      return match;
    });

    for (const type of typedPatterns) {
      rewritten = rewritten.replace(type.pattern, (match, alias: string, separator: string, ref: string, offset: number) => {
        const replacement = mappings.get(`${type.key}:${referenceKey(ref)}`);
        if (replacement) return `${alias}${separator}${replacement}`;
        unresolved.push({ start: offset, end: offset + match.length, failure: match });
        return match;
      });
    }

    for (const match of rewritten.matchAll(genericPattern)) {
      const failure = match[0];
      if (!failure) continue;
      const context = rewritten.slice(Math.max(0, match.index - 40), match.index + failure.length);
      const isKnownSuffix = typedPatterns.some((type) => new RegExp(`(?:${type.aliases.join("|")})(?:\\s+|\\.\\s*)\\d+(?:\\.[A-Za-z]+)+$`, "i").test(context))
        || /Acceptance\s+Criteria\s+\d+(?:\.[A-Za-z]+)+$/i.test(context);
      if (isKnownSuffix) continue;
      unresolved.push({ start: match.index, end: match.index + failure.length, failure });
    }
    unresolved.sort((left, right) => left.start - right.start);
    for (const failure of unresolved) failures.push({ section, failure: failure.failure });
    return rewritten;
  };

  plan.title = rewrite(plan.title, "Plan");
  plan.description = rewrite(plan.description, "Plan");
  plan.tags = plan.tags.map((tag) => rewrite(tag, "Plan"));
  for (const component of plan.components) {
    component.title = rewrite(component.title, component.ref);
    component.description = rewrite(component.description, component.ref);
    for (const type of referenceTypes) {
      for (const item of component[type.key]) {
        const section = `${type.label} ${item.ref}`;
        item.title = rewrite(item.title, section);
        item.details = rewrite(item.details, section);
        if ("findings" in item) item.findings = rewrite(item.findings, section);
      }
    }
  }
  for (const action of plan.actionItems) {
    action.title = rewrite(action.title, action.ref);
    action.context = rewrite(action.context, action.ref);
    for (const criterion of action.acceptanceCriteria) {
      const section = `Acceptance Criteria ${criterion.ref}`;
      criterion.title = rewrite(criterion.title, section);
      criterion.details = rewrite(criterion.details, section);
    }
    for (const source of action.triggerSources) {
      source.ref = rewrite(source.ref, action.ref);
      source.title = rewrite(source.title, action.ref);
    }
    action.assignees = action.assignees.map((assignee) => rewrite(assignee, action.ref));
  }

  return { plan, validationFailures: { ordering: failures } };
}

function nodeText(node: Node): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join("");
}

function lineLocation(node: Node): string {
  return node.position?.start.line === undefined ? "" : ` on line ${node.position.start.line}`;
}

function contentBetween(markdown: string, nodes: Node[], start: number, headingDepth: number): string {
  let end = start;
  for (let index = start; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.type === "heading" && (node.depth ?? 7) <= headingDepth) break;
    end = index + 1;
  }
  if (end === start) return "";
  const startOffset = nodes[start]?.position?.start.offset;
  const endOffset = nodes[end - 1]?.position?.end.offset;
  if (startOffset === undefined || endOffset === undefined) throw new Error("Markdown node is missing source position");
  return markdown.slice(startOffset, endOffset).trim();
}

function parseItems(markdown: string, nodes: Node[], start: number, end: number, statusRequired: boolean, depth = 4, allowedStatuses: readonly string[] = ["Open", "Decided", "Resolved", "Closed"]): Array<TextItem | StatusItem> {
  const items: Array<TextItem | StatusItem> = [];
  for (let index = start; index < end; index += 1) {
    const node = nodes[index]!;
    if (node.type !== "heading" || node.depth !== depth) continue;
    const heading = nodeText(node).trim();
    const match = heading.match(/^(?:Requirement|Constraint|Decision|Knowledge Gap|Finding|Note|Question|Acceptance Criteria)\s+([\w.-]+)(?:\s*[-:]\s*(.*))?$/i);
    if (!match) {
      throw new Error(`Plan Markdown error${lineLocation(node)}: invalid item heading \`${heading}\`. Expected \`#### <Item Type> <reference> - <title>\`, for example \`#### Requirement 1.A - Upload plans\`.`);
    }
    const ref = match[1]!;
    const title = match[2]?.trim() || heading;
    let details = contentBetween(markdown, nodes, index + 1, depth);
    if (statusRequired) {
      const statusMatch = details.match(/^(?:\*\*)?Status:(?:\*\*)?\s*([^\n]+)\s*(?:\n\n|\n)?/i);
      const suppliedStatus = statusMatch?.[1]?.trim();
      const normalizedStatus = allowedStatuses.find((status) => status.toLowerCase() === suppliedStatus?.toLowerCase());
      if (!statusMatch || !normalizedStatus) {
        const problem = suppliedStatus ? `invalid status \`${suppliedStatus}\`` : "missing required status";
        throw new Error(`Plan Markdown error${lineLocation(node)}: ${heading} has ${problem}. Add \`**Status:** ${allowedStatuses[0]}\` immediately below the heading; allowed values are ${allowedStatuses.join(", ")}.`);
      }
      details = details.slice(statusMatch[0].length).trim();
      items.push({ ref, title, status: normalizedStatus as StatusItem["status"], details });
    } else {
      items.push({ ref, title, details });
    }
  }
  return items;
}

function parseKnowledgeGaps(markdown: string, nodes: Node[], start: number, end: number): KnowledgeGap[] {
  const gapStarts = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node, index }) => index >= start && index < end && node.type === "heading" && node.depth === 4 && /^Knowledge Gap\s+/i.test(nodeText(node)))
    .map(({ index }) => index);

  return gapStarts.map((gapStart, gapIndex) => {
    const gapEnd = gapStarts[gapIndex + 1] ?? end;
    const findingsHeadings = nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node, index }) => index > gapStart && index < gapEnd && node.type === "heading" && node.depth === 5 && nodeText(node).trim() === "Findings")
      .map(({ index }) => index);
    const findingsHeading = findingsHeadings[0];
    if (findingsHeading === undefined) {
      throw new Error(`Plan Markdown error${lineLocation(nodes[gapStart]!)}: ${nodeText(nodes[gapStart]!)} is missing required \`##### Findings\` subsection.`);
    }
    if (findingsHeadings.length > 1) throw new Error(`Plan Markdown error${lineLocation(nodes[findingsHeadings[1]!]!)}: ${nodeText(nodes[gapStart]!)} contains more than one \`##### Findings\` subsection.`);
    const nestedFinding = nodes.find((node, index) => index > findingsHeading && index < gapEnd && node.type === "heading" && /^Finding\s+/i.test(nodeText(node).trim()));
    if (nestedFinding) throw new Error(`Plan Markdown error${lineLocation(nestedFinding)}: Findings must be direct content under \`##### Findings\`; remove the separate \`${nodeText(nestedFinding).trim()}\` heading.`);
    const gap = (parseItems(markdown, nodes.slice(0, findingsHeading), gapStart, findingsHeading, true, 4, knowledgeGapStatuses) as StatusItem[])[0]!;
    const findings = contentBetween(markdown, nodes, findingsHeading + 1, 5);
    if (gap.status === "Resolved" && !findings) throw new Error(`Plan Markdown error${lineLocation(nodes[gapStart]!)}: ${nodeText(nodes[gapStart]!)} cannot be \`Resolved\` with empty Findings.`);
    return {
      ...gap,
      status: gap.status as KnowledgeGap["status"],
      findings,
    };
  });
}

function parseComponent(markdown: string, nodes: Node[], start: number, end: number): Component {
  const heading = nodeText(nodes[start]!).replace(/\*\*/g, "").trim();
  const match = heading.match(/^(COMP-\d+)\s*-\s*(.+)$/);
  if (!match) throw new Error(`Plan Markdown error${lineLocation(nodes[start]!)}: invalid component heading \`${heading}\`. Expected \`## **COMP-<number> - <title>**\`.`);
  const sectionIndexes = new Map<string, number>();
  for (let index = start + 1; index < end; index += 1) {
    const node = nodes[index]!;
    if (node.type === "heading" && node.depth === 3) {
      const name = nodeText(node).replace(/\*\*/g, "").trim();
      if (!sections.includes(name as typeof sections[number])) throw new Error(`Plan Markdown error${lineLocation(node)}: ${match[1]} contains unsupported \`### ${name}\` subsection.`);
      if (sectionIndexes.has(name)) throw new Error(`Plan Markdown error${lineLocation(node)}: ${match[1]} contains duplicate \`### ${name}\` subsections.`);
      sectionIndexes.set(name, index);
    }
  }
  for (const name of sections) {
    if (!sectionIndexes.has(name)) throw new Error(`Plan Markdown error${lineLocation(nodes[start]!)}: ${match[1]} is missing required \`### ${name}\` subsection.`);
  }
  const firstSection = Math.min(...sectionIndexes.values(), end);
  const description = contentBetween(markdown, nodes, start + 1, 3);
  const range = (name: string): [number, number] => {
    const sectionStart = sectionIndexes.get(name);
    if (sectionStart === undefined) return [end, end];
    const next = [...sectionIndexes.values()].filter((value) => value > sectionStart).sort((a, b) => a - b)[0] ?? end;
    return [sectionStart + 1, next];
  };
  const [requirementsStart, requirementsEnd] = range("Requirements");
  const [constraintsStart, constraintsEnd] = range("Constraints");
  const [decisionsStart, decisionsEnd] = range("Decisions");
  const [gapsStart, gapsEnd] = range("Knowledge Gaps");
  const [notesStart, notesEnd] = range("Notes");
  const [questionsStart, questionsEnd] = range("Open Questions");
  void firstSection;
  const questions = parseItems(markdown, nodes, questionsStart, questionsEnd, false) as TextItem[];
  return {
    ref: match[1]!,
    title: match[2]!.trim(),
    description,
    requirements: parseItems(markdown, nodes, requirementsStart, requirementsEnd, false) as TextItem[],
    constraints: parseItems(markdown, nodes, constraintsStart, constraintsEnd, false) as TextItem[],
    decisions: parseItems(markdown, nodes, decisionsStart, decisionsEnd, true, 4, decisionStatuses) as Component["decisions"],
    knowledgeGaps: parseKnowledgeGaps(markdown, nodes, gapsStart, gapsEnd),
    notes: parseItems(markdown, nodes, notesStart, notesEnd, false) as TextItem[],
    questions: questions.map((question) => ({ ...question, details: question.details.replace(/^>\s?/, "") })),
  };
}

function parseBulletList(node: Node | undefined): string[] {
  if (node?.type !== "list") return [];
  return (node.children ?? []).map((item) => nodeText(item).trim()).filter(Boolean);
}

function parseActionItem(markdown: string, nodes: Node[], start: number, end: number): ActionItem {
  const heading = nodeText(nodes[start]!).replace(/\*\*/g, "").trim();
  const match = heading.match(/^(ACTION-\d+)\s*-\s*(.+)$/);
  if (!match) throw new Error(`Plan Markdown error${lineLocation(nodes[start]!)}: invalid action item heading \`${heading}\`. Expected \`## **ACTION-<number> - <title>**\`.`);
  const sections = new Map<string, number>();
  for (let index = start + 1; index < end; index += 1) {
    const node = nodes[index]!;
    if (node.type === "heading" && node.depth === 3) sections.set(nodeText(node).replace(/\*\*/g, "").trim(), index);
  }
  const requiredSections = ["Acceptance Criteria", "Trigger Sources", "Assignees"];
  for (const name of requiredSections) {
    if (!sections.has(name)) throw new Error(`Plan Markdown error${lineLocation(nodes[start]!)}: ${match[1]} is missing required \`### ${name}\` subsection.`);
  }
  const firstSection = Math.min(...sections.values());
  const preamble = contentBetween(markdown, nodes, start + 1, 3);
  const statusMatch = preamble.match(/^(?:\*\*)?Status:(?:\*\*)?\s*(TODO|In Progress|Done|Closed)\s*(?:\n\n|\n)?/i);
  if (!statusMatch) throw new Error(`Plan Markdown error${lineLocation(nodes[start]!)}: ${match[1]} has a missing or invalid status. Allowed values are TODO, In Progress, Done, and Closed.`);
  const sectionEnd = (sectionStart: number) => [...sections.values()].filter((value) => value > sectionStart).sort((a, b) => a - b)[0] ?? end;
  const acceptanceStart = sections.get("Acceptance Criteria")!;
  const triggerStart = sections.get("Trigger Sources")!;
  const assigneesStart = sections.get("Assignees")!;
  const triggerEntries = parseBulletList(nodes.slice(triggerStart + 1, sectionEnd(triggerStart)).find((node) => node.type === "list"));
  void firstSection;
  return {
    ref: match[1]!,
    title: match[2]!.trim(),
    status: statusMatch[1]!.toLowerCase() === "todo" ? "TODO" : statusMatch[1]!.replace(/\b\w/g, (value) => value.toUpperCase()) as ActionItem["status"],
    context: preamble.slice(statusMatch[0].length).trim(),
    acceptanceCriteria: parseItems(markdown, nodes, acceptanceStart + 1, sectionEnd(acceptanceStart), false) as TextItem[],
    triggerSources: triggerEntries.map((entry) => {
      const source = entry.match(/^(.+?)\s+-\s+(.+)$/);
      if (!source) throw new Error(`Plan Markdown error: invalid trigger source \`${entry}\`. Expected \`- <reference> - <short description>\`.`);
      return { ref: source[1]!, title: source[2]! };
    }),
    assignees: parseBulletList(nodes.slice(assigneesStart + 1, sectionEnd(assigneesStart)).find((node) => node.type === "list")),
  };
}

export function ingestPlanMarkdown(markdown: string): PlanIngestResult {
  const parsed = matter(markdown);
  const tree = fromMarkdown(parsed.content) as Node;
  const nodes = tree.children ?? [];
  const rootHeadings = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.type === "heading" && node.depth === 1);
  const componentHeadings = rootHeadings.filter(({ node }) => nodeText(node).trim() === "Components");
  const actionHeadings = rootHeadings.filter(({ node }) => nodeText(node).trim() === "Action Items");
  if (componentHeadings.length === 0) throw new Error("Plan Markdown error: missing required `# Components` heading.");
  if (componentHeadings.length > 1) throw new Error("Plan Markdown error: document contains more than one `# Components` heading.");
  if (actionHeadings.length === 0) throw new Error("Plan Markdown error: missing required `# Action Items` heading.");
  if (actionHeadings.length > 1) throw new Error("Plan Markdown error: document contains more than one `# Action Items` heading.");
  const componentsHeading = componentHeadings[0]!.index;
  const actionsHeading = actionHeadings[0]!.index;
  if (actionsHeading < componentsHeading) throw new Error("Plan Markdown error: `# Action Items` must appear after `# Components`.");
  const componentStarts = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node, index }) => index > componentsHeading && index < actionsHeading && node.type === "heading" && node.depth === 2 && /^COMP-\d+\s*-/.test(nodeText(node).replace(/\*\*/g, "").trim()))
    .map(({ index }) => index);
  const components = componentStarts.map((start, index) => parseComponent(parsed.content, nodes, start, componentStarts[index + 1] ?? actionsHeading));
  const actionStarts = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node, index }) => index > actionsHeading && node.type === "heading" && node.depth === 2 && /^ACTION-\d+\s*-/.test(nodeText(node).replace(/\*\*/g, "").trim()))
    .map(({ index }) => index);
  const actionItems = actionStarts.map((start, index) => parseActionItem(parsed.content, nodes, start, actionStarts[index + 1] ?? nodes.length));
  const result = planSchema.safeParse({
    reference: String(parsed.data.reference ?? "New"),
    title: parsed.data.title,
    description: parsed.data.description ?? "",
    tags: parsed.data.tags ?? [],
    status: parsed.data.status ?? "Draft",
    components,
    actionItems,
  });
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path[0] === "title" || issue.path[0] === "description" || issue.path[0] === "tags" || issue.path[0] === "status" || issue.path[0] === "reference"
        ? `frontmatter.${issue.path.join(".")}`
        : issue.path.join(".");
      return `\`${path || "document"}\`: ${issue.message}`;
    });
    throw new Error(`Plan Markdown error: invalid or missing document fields: ${issues.join("; ")}.`);
  }
  return normalizePlan(result.data);
}

export function parsePlanMarkdown(markdown: string): Plan {
  return ingestPlanMarkdown(markdown).plan;
}

function renderItems(title: typeof sections[number], items: Array<TextItem | StatusItem>, label: string): string {
  const body = items.map((item) => {
    const status = "status" in item ? `\n\n**Status:** ${item.status}` : "";
    const details = title === "Open Questions" && item.details ? `> ${item.details.replace(/^>\s*/, "")}` : item.details;
    return `#### ${label} ${item.ref}${item.title !== `${label} ${item.ref}` ? ` - ${item.title}` : ""}${status}\n\n${details}`.trimEnd();
  }).join("\n\n");
  return `### **${title}**\n\n${body}`.trimEnd();
}

function renderKnowledgeGaps(gaps: KnowledgeGap[]): string {
  const body = gaps.map((gap) => {
    return `#### Knowledge Gap ${gap.ref}${gap.title !== `Knowledge Gap ${gap.ref}` ? ` - ${gap.title}` : ""}\n\n**Status:** ${gap.status}\n\n${gap.details}\n\n##### Findings\n\n${gap.findings}`.trimEnd();
  }).join("\n\n");
  return `### **Knowledge Gaps**\n\n${body}`.trimEnd();
}

export function formatPlanMarkdown(planInput: Plan): string {
  const plan = planSchema.parse(planInput);
  const frontmatter = YAML.stringify({
    reference: plan.reference,
    title: plan.title,
    description: plan.description,
    tags: plan.tags,
    status: plan.status,
  }).trim();
  const table = plan.components.map((component) => `| ${component.ref} | ${component.title} |`).join("\n");
  const components = plan.components.map((component) => [
    `## **${component.ref} - ${component.title}**`,
    component.description,
    renderItems("Requirements", component.requirements, "Requirement"),
    renderItems("Constraints", component.constraints, "Constraint"),
    renderItems("Decisions", component.decisions, "Decision"),
    renderKnowledgeGaps(component.knowledgeGaps),
    renderItems("Notes", component.notes, "Note"),
    renderItems("Open Questions", component.questions, "Question"),
  ].join("\n\n")).join("\n\n");
  const actions = plan.actionItems.map((action) => {
    const criteria = action.acceptanceCriteria.map((criterion) => `#### Acceptance Criteria ${criterion.ref}${criterion.title !== `Acceptance Criteria ${criterion.ref}` ? ` - ${criterion.title}` : ""}\n\n${criterion.details}`.trimEnd()).join("\n\n");
    const sources = action.triggerSources.map((source) => `- ${source.ref} - ${source.title}`).join("\n");
    const assignees = action.assignees.map((assignee) => `- ${assignee}`).join("\n");
    return `## **${action.ref} - ${action.title}**\n\n**Status:** ${action.status}\n\n${action.context}\n\n### Acceptance Criteria\n\n${criteria}\n\n### Trigger Sources\n\n${sources}\n\n### Assignees\n\n${assignees}`.trimEnd();
  }).join("\n\n");
  return `---\n${frontmatter}\n---\n\n# Components\n\n| Ref | Short Description |\n|---|---|\n${table}\n\n${components}\n\n# Action Items\n\n${actions}\n`;
}
