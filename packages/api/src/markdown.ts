import matter from "gray-matter";
import { fromMarkdown } from "mdast-util-from-markdown";
import YAML from "yaml";
import { planSchema, type Component, type Plan, type StatusItem, type TextItem } from "./domain.js";

type Node = {
  type: string;
  depth?: number;
  value?: string;
  children?: Node[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
};

const sections = [
  "Requirements",
  "Constraints",
  "Decisions",
  "Knowledge Gaps",
  "Findings",
  "Notes",
  "Open Questions",
] as const;

function nodeText(node: Node): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join("");
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

function parseItems(markdown: string, nodes: Node[], start: number, end: number, statusRequired: boolean): Array<TextItem | StatusItem> {
  const items: Array<TextItem | StatusItem> = [];
  for (let index = start; index < end; index += 1) {
    const node = nodes[index]!;
    if (node.type !== "heading" || node.depth !== 4) continue;
    const heading = nodeText(node).trim();
    const match = heading.match(/^(?:Requirement|Constraint|Decision|Knowledge Gap|Finding|Note|Question)\s+([\w.-]+)(?:\s*[-:]\s*(.*))?$/i);
    if (!match) throw new Error(`Invalid item heading: ${heading}`);
    const ref = match[1]!;
    const title = match[2]?.trim() || heading;
    let details = contentBetween(markdown, nodes, index + 1, 4);
    if (statusRequired) {
      const statusMatch = details.match(/^(?:\*\*)?Status:(?:\*\*)?\s*(Open|Decided|Resolved|Closed)\s*(?:\n\n|\n)?/i);
      if (!statusMatch) throw new Error(`Missing or invalid status for ${heading}`);
      details = details.slice(statusMatch[0].length).trim();
      const normalized = statusMatch[1]![0]!.toUpperCase() + statusMatch[1]!.slice(1).toLowerCase();
      items.push({ ref, title, status: normalized as StatusItem["status"], details });
    } else {
      items.push({ ref, title, details });
    }
  }
  return items;
}

function parseComponent(markdown: string, nodes: Node[], start: number, end: number): Component {
  const heading = nodeText(nodes[start]!).replace(/\*\*/g, "").trim();
  const match = heading.match(/^(COMP-\d+)\s*-\s*(.+)$/);
  if (!match) throw new Error(`Invalid component heading: ${heading}`);
  const sectionIndexes = new Map<string, number>();
  for (let index = start + 1; index < end; index += 1) {
    const node = nodes[index]!;
    if (node.type === "heading" && node.depth === 3) sectionIndexes.set(nodeText(node).replace(/\*\*/g, "").trim(), index);
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
  const [findingsStart, findingsEnd] = range("Findings");
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
    decisions: parseItems(markdown, nodes, decisionsStart, decisionsEnd, true) as StatusItem[],
    knowledgeGaps: parseItems(markdown, nodes, gapsStart, gapsEnd, true) as StatusItem[],
    findings: parseItems(markdown, nodes, findingsStart, findingsEnd, false) as TextItem[],
    notes: parseItems(markdown, nodes, notesStart, notesEnd, false) as TextItem[],
    questions: questions.map((question) => ({ ...question, details: question.details.replace(/^>\s?/, "") })),
  };
}

export function parsePlanMarkdown(markdown: string): Plan {
  const parsed = matter(markdown);
  const tree = fromMarkdown(parsed.content) as Node;
  const nodes = tree.children ?? [];
  const componentsHeading = nodes.findIndex((node) => node.type === "heading" && node.depth === 1 && nodeText(node).trim() === "Components");
  if (componentsHeading < 0) throw new Error("Missing # Components heading");
  const componentStarts = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node, index }) => index > componentsHeading && node.type === "heading" && node.depth === 2 && /^COMP-\d+\s*-/.test(nodeText(node).replace(/\*\*/g, "").trim()))
    .map(({ index }) => index);
  const components = componentStarts.map((start, index) => parseComponent(parsed.content, nodes, start, componentStarts[index + 1] ?? nodes.length));
  return planSchema.parse({
    reference: String(parsed.data.reference ?? "New"),
    title: parsed.data.title,
    description: parsed.data.description ?? "",
    tags: parsed.data.tags ?? [],
    status: parsed.data.status ?? "Draft",
    components,
  });
}

function renderItems(title: typeof sections[number], items: Array<TextItem | StatusItem>, label: string): string {
  const body = items.map((item) => {
    const status = "status" in item ? `\n\n**Status:** ${item.status}` : "";
    const details = title === "Open Questions" && item.details ? `> ${item.details.replace(/^>\s*/, "")}` : item.details;
    return `#### ${label} ${item.ref}${item.title !== `${label} ${item.ref}` ? ` - ${item.title}` : ""}${status}\n\n${details}`.trimEnd();
  }).join("\n\n");
  return `### **${title}**\n\n${body}`.trimEnd();
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
    renderItems("Knowledge Gaps", component.knowledgeGaps, "Knowledge Gap"),
    renderItems("Findings", component.findings, "Finding"),
    renderItems("Notes", component.notes, "Note"),
    renderItems("Open Questions", component.questions, "Question"),
  ].join("\n\n")).join("\n\n");
  return `---\n${frontmatter}\n---\n\n# Components\n\n| Ref | Short Description |\n|---|---|\n${table}\n\n${components}\n`;
}
