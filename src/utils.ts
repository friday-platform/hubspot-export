import { convert } from "html-to-text";

/** Convert HTML to plain text. */
export function stripHtml(html: string): string {
  return convert(html, { wordwrap: false }).trim();
}
