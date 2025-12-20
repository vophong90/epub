import sanitizeHtml from "sanitize-html";

export function sanitizeEditorHTML(dirty: string) {
  return sanitizeHtml(dirty || "", {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "u",
      "s",
      "blockquote",
      "code",
      "pre",
      "h2",
      "h3",
      "h4",
      "h5",
      "ul",
      "ol",
      "li",
      "a",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "img",
      "hr",
      "span",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
      span: ["style"],
      p: ["style"],
      h2: ["style"],
      h3: ["style"],
      h4: ["style"],
      h5: ["style"],
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    allowProtocolRelative: false,
    // chặn style “bậy” (Word hay nhét nhiều)
    allowedStyles: {
      "*": {
        "text-align": [/^left$/, /^right$/, /^center$/, /^justify$/],
      },
    },
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href || "";
        const safeHref = href.startsWith("javascript:") ? "" : href;
        return {
          tagName: "a",
          attribs: {
            href: safeHref,
            target: "_blank",
            rel: "noopener noreferrer",
          },
        };
      },
    },
  });
}
