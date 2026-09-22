import { CONTENT_TYPE_LABELS, type ContentType, type ExecutiveOrder } from "@/lib/types";

/**
 * The header every generated draft opens with: a title, what kind of piece
 * it is, and exactly which orders it was written from, each linked to its
 * source.
 *
 * The split of responsibility matters. The TITLE is written by the model,
 * because naming a piece is a judgement about its content. Everything else
 * here is built from the database, because it is fact: the order numbers,
 * and above all the URLs. A model asked to emit links will eventually emit a
 * plausible one that does not exist, and this draft is a document a law firm
 * may send to a client. Nothing in this file lets the model near a URL.
 *
 * Pure -- orders in, markdown out -- so it is covered without an API call.
 */

/**
 * Past this, the model's first line is prose rather than a title, and using
 * it as one would decapitate the draft. Generous: real titles run long.
 */
const MAX_TITLE_CHARS = 140;

/** Shown where an order has no Federal Register URL on file. */
const NO_SOURCE_NOTE = "no source link on file";

/**
 * How one order is named in the list: its EO number, or its subject area
 * when it has no number -- proclamations and memoranda never do.
 */
export function orderLabel(order: ExecutiveOrder): string {
  if (order.eoNumber) return order.eoNumber;
  const [subject] = order.subjectArea;
  return subject ?? order.actionType ?? "Executive action";
}

function orderListItem(order: ExecutiveOrder): string {
  const label = `${orderLabel(order)} — ${order.title}`;
  // Only ever a URL the database holds. Never one the model produced, and
  // never one built by pattern from an identifier.
  return order.federalRegisterUrl
    ? `- [${label}](${order.federalRegisterUrl})`
    : `- ${label} (${NO_SOURCE_NOTE})`;
}

/**
 * Separates the model's title line from the rest of its output.
 *
 * Returns a null title when the first line does not look like one, so a
 * model that ignored the instruction loses its header rather than its first
 * paragraph.
 */
export function splitTitleFromDraft(draftText: string): { title: string | null; body: string } {
  const lines = draftText.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex === -1) return { title: null, body: draftText };

  const candidate = lines[firstContentIndex]
    .trim()
    // Strip markdown the model may add despite being asked not to.
    .replace(/^#+\s*/, "")
    .replace(/^\*+|\*+$/g, "")
    .trim();

  if (!candidate || candidate.length > MAX_TITLE_CHARS) {
    return { title: null, body: draftText };
  }

  return {
    title: candidate,
    body: lines
      .slice(firstContentIndex + 1)
      .join("\n")
      .trim(),
  };
}

/** Used when the model gave no usable title, so the header still names the piece. */
export function fallbackTitle(orders: ExecutiveOrder[]): string {
  if (orders.length === 1) return orders[0].title;
  return `${orders.length} executive actions`;
}

export function buildContentHeader(
  orders: ExecutiveOrder[],
  contentType: ContentType,
  title: string,
): string {
  return [
    `# ${title} (${CONTENT_TYPE_LABELS[contentType]})`,
    "",
    orders.length === 1 ? "**Executive order covered:**" : "**Executive orders covered:**",
    "",
    ...orders.map(orderListItem),
  ].join("\n");
}

/**
 * Puts the model's draft together with its header.
 *
 * Kept separate from generateContent so the assembly is testable without an
 * API call, and so a stub draft gets the same shape as a real one.
 */
export function assembleDraft(
  orders: ExecutiveOrder[],
  contentType: ContentType,
  modelOutput: string,
): string {
  const { title, body } = splitTitleFromDraft(modelOutput);
  const header = buildContentHeader(orders, contentType, title ?? fallbackTitle(orders));
  const content = title === null ? modelOutput.trim() : body;
  return content ? `${header}\n\n---\n\n${content}` : header;
}
