// Small, safe markdown renderer for chat messages.
// All text is HTML-escaped first; only the markup generated here reaches innerHTML.
// Supports: headings, paragraphs, line breaks, **bold**, *italic*/_italic_, ~~strike~~, `code`,
// fenced code blocks, links (http/https/mailto only), bare URLs, ordered/unordered lists (one nesting level
// by indentation), blockquotes, horizontal rules and pipe tables.

import { escapeHtml } from './dom.js';

function safeUrl(url) {
  const u = url.trim().replace(/&amp;/g, '&');
  if (/^(https?:|mailto:)/i.test(u) || u.startsWith('/') || u.startsWith('#')) return escapeHtml(u);
  return null;
}

/** Inline formatting on an already-escaped string. */
function inline(s) {
  const codes = [];
  // Generated anchor markup is held out of the string while emphasis runs: otherwise `_`/`*`/`~` in URLs or in
  // `target="_blank"` get <em>/<strong> spliced into attribute values and tags end up mis-nested.
  const held = [];
  const hold = (html) => { held.push(html); return `\u0001${held.length - 1}\u0001`; };
  // Protect inline code spans first.
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  // Links [text](url)
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const u = safeUrl(url);
    return u ? `${hold(`<a href="${u}" target="_blank" rel="noopener noreferrer">`)}${text}${hold('</a>')}` : text;
  });
  // Bare URLs (not already inside an href attribute or anchor text)
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)\u0001]+)/g, (m, pre, url) => {
    const u = safeUrl(url);
    return u ? `${pre}${hold(`<a href="${u}" target="_blank" rel="noopener noreferrer">${url}</a>`)}` : m;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)] ?? ''}</code>`);
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => held[Number(i)] ?? '');
  return s;
}

const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const splitRow = (line) => {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
};

export function renderMarkdown(src) {
  // \u0000 / \u0001 are placeholder markers in inline(): never accept them from the input.
  const lines = escapeHtml(String(src ?? '').replace(/[\u0000\u0001]/g, '')).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block (an unterminated fence renders to the end, useful while streaming)
    const fence = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const body = [];
      i++;
      while (i < lines.length && !new RegExp('^\\s*' + fence[1] + '\\s*$').test(lines[i])) body.push(lines[i++]);
      i++;
      const lang = fence[2] ? ` data-lang="${fence[2]}"` : '';
      out.push(`<pre class="md-code"${lang}>${fence[2] ? `<span class="md-lang">${fence[2]}</span>` : ''}<code>${body.join('\n')}</code></pre>`);
      continue;
    }

    if (!line.trim()) { flushPara(); i++; continue; }

    const hd = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hd) {
      flushPara();
      const lvl = Math.min(6, hd[1].length + 2); // h3..h6 inside chat bubbles
      out.push(`<h${lvl}>${inline(hd[2].replace(/\s+#+\s*$/, ''))}</h${lvl}>`);
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); out.push('<hr>'); i++; continue; }

    if (/^\s*&gt;/.test(line)) {
      flushPara();
      const q = [];
      while (i < lines.length && /^\s*&gt;/.test(lines[i])) q.push(lines[i++].replace(/^\s*&gt;\s?/, ''));
      out.push(`<blockquote>${renderMarkdownEscaped(q)}</blockquote>`);
      continue;
    }

    // Table: header row + separator row
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara();
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      const cell = (tag, c, j) => `<${tag}${aligns[j] ? ` style="text-align:${aligns[j]}"` : ''}>${inline(c)}</${tag}>`;
      out.push(`<div class="md-table-wrap"><table><thead><tr>${head.map((c, j) => cell('th', c, j)).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c, j) => cell('td', c, j)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m) {
          if (m[1].length >= 2 && items.length) {
            const last = items[items.length - 1];
            (last.sub = last.sub || { ordered: /\d/.test(m[2]), items: [] }).items.push(m[3]);
          } else {
            items.push({ text: m[3] });
          }
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1].text += '<br>' + lines[i].trim();
          i++;
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const start = ordered ? parseInt(li[2], 10) : 1;
      out.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${items
        .map((it) => {
          const sub = it.sub ? `<${it.sub.ordered ? 'ol' : 'ul'}>${it.sub.items.map((s) => `<li>${inline(s)}</li>`).join('')}</${it.sub.ordered ? 'ol' : 'ul'}>` : '';
          return `<li>${inline(it.text)}${sub}</li>`;
        }).join('')}</${tag}>`);
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return out.join('');
}

// Used for blockquotes: input lines are already escaped, so render without escaping again.
function renderMarkdownEscaped(lines) {
  return lines.filter((l) => l.trim()).map((l) => `<p>${inline(l)}</p>`).join('');
}
