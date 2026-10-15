/** Minimal, safe markdown → HTML for evidence packs. Escapes FIRST, then
 *  applies only the constructs our packs emit: #/##/### headings, - lists
 *  (one nesting level), **bold**, `code`, --- rules, paragraphs. No raw HTML
 *  ever passes through. */
const escapeHtml = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export function mdToHtml(src: string): string {
  const lines = escapeHtml(src).split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];

  const inline = (s: string) =>
    s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const ul = line.match(/^-\s+(.*)$/);
    const nested = line.match(/^\s{2,}-\s+(.*)$/);
    if (line === "---") {
      flushPara();
      closeList();
      out.push("<hr/>");
      continue;
    }
    if (h) {
      flushPara();
      closeList();
      const level = Math.min(h[1].length + 1, 4);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    if (ul) {
      flushPara();
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    if (nested && list === "ul") {
      // flatten one nesting level into the same list, indented
      out.push(`<li class="ind">${inline(nested[1])}</li>`);
      continue;
    }
    if (line === "") {
      flushPara();
      closeList();
      continue;
    }
    para.push(line);
  }
  flushPara();
  closeList();
  return out.join("\n");
}
