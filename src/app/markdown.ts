/** Tiny, safe markdown → HTML for issue bodies. Everything is escaped first. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const BR = "\u0001";

function inline(s: string): string {
  let t = esc(s.replace(/<br\s*\/?>/gi, BR));
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[\s(])_([^_]+)_(?=[\s).,:;!?]|$)/g, "$1<em>$2</em>");
  t = t.replace(/!\[[^\]]*\]\(([^)\s]+)\)/g, (_m, u) => `<a href="${u}" data-ext>[image]</a>`);
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" data-ext>$1</a>');
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" data-ext>$2</a>');
  return t.replaceAll(BR, "<br>");
}

export function renderMarkdown(src: string): string {
  const out: string[] = [];
  const lines = src.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "").split("\n");
  let i = 0;
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      closeList();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const lvl = Math.min(h[1].length + 2, 6);
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
    } else if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(line)) {
      if (list !== "ul") (closeList(), out.push('<ul class="tasks">'), (list = "ul"));
      const done = /\[[xX]\]/.test(line);
      out.push(`<li class="${done ? "done" : ""}"><span class="box">${done ? "✓" : ""}</span>${inline(line.replace(/^\s*[-*]\s+\[[ xX]\]\s+/, ""))}</li>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (list !== "ul") (closeList(), out.push("<ul>"), (list = "ul"));
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
    } else if (/^\s*\d+\.\s+/.test(line)) {
      if (list !== "ol") (closeList(), out.push("<ol>"), (list = "ol"));
      out.push(`<li>${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
    } else if (/^>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
    i++;
  }
  closeList();
  return out.join("\n");
}
