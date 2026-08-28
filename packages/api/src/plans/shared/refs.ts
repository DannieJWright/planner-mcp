/**
 * Canonical reference formats and reference-shaped string handling.
 *
 * Every regular expression that recognizes a `COMP-<n>` or `ACTION-<n>` reference is
 * built here from a node descriptor's `refPrefix`. No other module may spell those
 * prefixes; that is what keeps the heading matchers, the Zod schemas, the patch
 * placeholders, and the normalizer from drifting apart.
 */

/** Placeholder reference an agent uses to create a node in a partial document. */
export const newNodePlaceholder = "New";

/** Escape a literal for safe embedding in a regular expression. */
function escape(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Canonical whole-string reference pattern, e.g. `/^COMP-\d+$/`. */
export function canonicalRefPattern(prefix: string): RegExp {
  return new RegExp(`^${escape(prefix)}\\d+$`);
}

/**
 * Heading matcher for `<PREFIX><number> - <title>`.
 *
 * `allowPlaceholder` additionally accepts the `New` placeholder and makes matching
 * case-insensitive, which is what partial documents require.
 */
export function refHeadingPattern(prefix: string, allowPlaceholder: boolean): RegExp {
  const number = allowPlaceholder ? `(?:\\d+|${newNodePlaceholder})` : "\\d+";
  return allowPlaceholder
    ? new RegExp(`^(${escape(prefix)}${number})\\s*-\\s*(.+)$`, "i")
    : new RegExp(`^(${escape(prefix)}${number})\\s*-\\s*(.+)$`);
}

/** Cheap prefilter deciding whether a heading begins a node of this type. */
export function refHeadingPrefix(prefix: string, allowPlaceholder: boolean): RegExp {
  const number = allowPlaceholder ? `(?:\\d+|${newNodePlaceholder})` : "\\d+";
  return allowPlaceholder
    ? new RegExp(`^${escape(prefix)}${number}\\s*-`, "i")
    : new RegExp(`^${escape(prefix)}${number}\\s*-`);
}

/** The `<PREFIX>New` placeholder reference for a node type. */
export function placeholderRef(prefix: string): string {
  return `${prefix}${newNodePlaceholder}`;
}

/** Restore canonical casing to a reference parsed from a partial document. */
export function canonicalizeRef(value: string, prefix: string): string {
  return value
    .replace(new RegExp(`^${escape(prefix)}`, "i"), prefix)
    .replace(new RegExp(`${newNodePlaceholder}$`, "i"), newNodePlaceholder);
}

/** Numeric suffix of a canonical reference, or `undefined` when it has none. */
export function refNumber(value: string, prefix: string): number | undefined {
  if (!value.startsWith(prefix)) return undefined;
  const parsed = Number(value.slice(prefix.length));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Zero-based item index to its canonical letter label: `A`…`Z`, then `A.A`…`Z.Z`, and
 * so on, so an unbounded number of items keeps a stable sortable label.
 */
export function subsectionLabel(index: number): string {
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

function refSortKey(ref: string): { component: number; letters: string[]; raw: string } | undefined {
  const match = ref.trim().match(/^(\d+)\.([A-Za-z]+(?:\.[A-Za-z]+)*)$/);
  if (!match) return undefined;
  return { component: Number(match[1]), letters: match[2]!.split("."), raw: ref };
}

/**
 * Ascending comparator for canonical item references (`<component>.<letter groups>`),
 * ordering by component number, then by letter-group depth, then alphabetically.
 * Non-canonical references sort after canonical ones, compared as plain strings.
 */
export function compareItemRefs(left: string, right: string): number {
  const a = refSortKey(left);
  const b = refSortKey(right);
  if (!a || !b) {
    if (!a && !b) return left.localeCompare(right);
    return a ? -1 : 1;
  }
  if (a.component !== b.component) return a.component - b.component;
  if (a.letters.length !== b.letters.length) return a.letters.length - b.letters.length;
  for (let index = 0; index < a.letters.length; index += 1) {
    const comparison = a.letters[index]!.localeCompare(b.letters[index]!);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

/** Normalize a reference for case- and whitespace-insensitive lookup. */
export function referenceKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
