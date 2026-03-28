import type { TLRichText } from "@tldraw/tlschema";

/** Rich text with bold marks on each line (heading captures). */
/** Blockquote-style: curly quotes around full text, bold + italic (reference UI). */
export function toRichTextQuote(text: string): TLRichText {
  const body = text.trim();
  const wrapped = `\u201c${body}\u201d`;
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: wrapped,
            marks: [{ type: "bold" }, { type: "italic" }],
          },
        ],
      },
    ],
  };
}

export function toRichTextBold(text: string): TLRichText {
  const lines = text.split("\n");
  return {
    type: "doc",
    content: lines.map((line) => {
      if (!line) {
        return {
          type: "paragraph",
        };
      }
      return {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: line,
            marks: [{ type: "bold" }],
          },
        ],
      };
    }),
  };
}
