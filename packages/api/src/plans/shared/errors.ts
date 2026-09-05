/**
 * Descriptor-driven parse error messages.
 *
 * Every message that names a section, an item label, or a heading shape is generated
 * here from descriptor values, so no error string embeds a hardcoded plan vocabulary
 * term. Callers pass the descriptor-derived pieces; this module owns the wording.
 */
import { lineLocation, type MarkdownNode } from "./ast.js";

const prefix = "Plan Markdown error";

/** `Plan Markdown error on line 12: <detail>` */
export function planError(node: MarkdownNode | undefined, detail: string): Error {
  return new Error(`${prefix}${node ? lineLocation(node) : ""}: ${detail}`);
}

/** Render a heading of `depth` with the given text, e.g. `### Requirements`. */
export function headingLiteral(depth: number, text: string): string {
  return `${"#".repeat(depth)} ${text}`;
}

export function missingRootHeading(text: string): Error {
  return new Error(`${prefix}: missing required \`${headingLiteral(1, text)}\` heading.`);
}

export function duplicateRootHeading(text: string): Error {
  return new Error(`${prefix}: document contains more than one \`${headingLiteral(1, text)}\` heading.`);
}

export function rootHeadingOutOfOrder(later: string, earlier: string): Error {
  return new Error(`${prefix}: \`${headingLiteral(1, later)}\` must appear after \`${headingLiteral(1, earlier)}\`.`);
}

export function invalidNodeHeading(
  node: MarkdownNode,
  nodeLabel: string,
  heading: string,
  expected: string,
): Error {
  return planError(node, `invalid ${nodeLabel} heading \`${heading}\`. Expected \`${expected}\`.`);
}

export function unsupportedSubsection(node: MarkdownNode, owner: string, depth: number, name: string): Error {
  return planError(node, `${owner} contains unsupported \`${headingLiteral(depth, name)}\` subsection.`);
}

export function duplicateSubsection(node: MarkdownNode, owner: string, depth: number, name: string): Error {
  return planError(node, `${owner} contains duplicate \`${headingLiteral(depth, name)}\` subsections.`);
}

export function missingSubsection(
  node: MarkdownNode | undefined,
  owner: string,
  depth: number,
  name: string,
): Error {
  return planError(node, `${owner} is missing required \`${headingLiteral(depth, name)}\` subsection.`);
}

export function duplicateNestedSubsection(
  node: MarkdownNode,
  owner: string,
  depth: number,
  name: string,
): Error {
  return planError(node, `${owner} contains more than one \`${headingLiteral(depth, name)}\` subsection.`);
}

export function invalidItemHeading(
  node: MarkdownNode,
  heading: string,
  exampleLabel: string,
  itemDepth: number,
): Error {
  return planError(
    node,
    `invalid item heading \`${heading}\`. Expected \`${headingLiteral(itemDepth, "<Item Type> <reference> - <title>")}\`, `
    + `for example \`${headingLiteral(itemDepth, `${exampleLabel} 1.A - Upload plans`)}\`.`,
  );
}

export function invalidStatus(
  node: MarkdownNode,
  owner: string,
  supplied: string | undefined,
  allowed: readonly string[],
): Error {
  const problem = supplied ? `invalid status \`${supplied}\`` : "missing required status";
  return planError(
    node,
    `${owner} has ${problem}. Add \`**Status:** ${allowed[0]}\` immediately below the heading; `
    + `allowed values are ${allowed.join(", ")}.`,
  );
}

export function invalidMetadataStatus(
  node: MarkdownNode,
  owner: string,
  supplied: string,
  allowed: readonly string[],
): Error {
  return planError(node, `${owner} has invalid status \`${supplied}\`; allowed values are ${allowed.join(", ")}.`);
}

export function unsupportedStatusField(node: MarkdownNode, owner: string): Error {
  return planError(node, `${owner} does not support a \`Status\` metadata field.`);
}

export function nestedItemInProse(
  node: MarkdownNode,
  sectionName: string,
  sectionDepth: number,
  heading: string,
): Error {
  return planError(
    node,
    `${sectionName} must be direct content under \`${headingLiteral(sectionDepth, sectionName)}\`; `
    + `remove the separate \`${heading}\` heading.`,
  );
}

export function resolvedWithEmptyProse(
  node: MarkdownNode,
  owner: string,
  status: string,
  sectionName: string,
): Error {
  return planError(node, `${owner} cannot be \`${status}\` with empty ${sectionName}.`);
}

export function invalidBullet(entryLabel: string, entry: string, expected: string): Error {
  return new Error(`${prefix}: invalid ${entryLabel} \`${entry}\`. Expected \`${expected}\`.`);
}

export function invalidBoolean(owner: string, field: string, value: string): Error {
  return new Error(`${prefix}: ${owner} has an invalid \`${field}\` value \`${value}\`. Expected \`true\` or \`false\`.`);
}

export function invalidPosition(owner: string, value: string): Error {
  return new Error(`${prefix}: ${owner} has an invalid \`Position\` value \`${value}\`. Expected a whole number.`);
}

export function invalidFrontmatterStatus(supplied: string, allowed: readonly string[]): Error {
  return new Error(`${prefix}: invalid frontmatter status \`${supplied}\`; allowed values are ${allowed.join(", ")}.`);
}

export function invalidDocumentFields(issues: string[]): Error {
  return new Error(`${prefix}: invalid or missing document fields: ${issues.join("; ")}.`);
}

export function unsupportedBlockHeading(node: MarkdownNode, heading: string, expected: string[]): Error {
  return planError(
    node,
    `unsupported \`${headingLiteral(2, heading)}\` heading. Expected ${expected.map((value) => `\`${value}\``).join(" or ")}.`,
  );
}

export function missingPersistedReference(): Error {
  return new Error(`${prefix}: a partial plan document must carry the persisted plan \`reference\` in its frontmatter.`);
}
