// Hardening: XSS in browser renderers that reach innerHTML (chat markdown, symbol names, drawing styles).
// The web modules below are plain ESM without DOM access at import time, so they are tested here offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../../web/src/panels/util/markdown.js';
import { escapeHtml, SYMBOL_KEY_RE } from '../../web/src/chart/util.js';

const TAGS = new Set(['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'span', 'a', 'h3', 'h4', 'h5', 'h6', 'hr', 'blockquote', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'ul', 'ol', 'li']);
const ATTRS = new Set(['href', 'target', 'rel', 'class', 'data-lang', 'style', 'start']);

/** Strict scan of renderer output: only allow-listed tags/attributes, quoted values, safe URLs and styles. */
function assertSafeHtml(html, input) {
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>/g;
  let m;
  let rest = html;
  while ((m = tagRe.exec(html))) {
    const [, name, attrs] = m;
    assert.ok(TAGS.has(name.toLowerCase()), `tag <${name}> from ${JSON.stringify(input)}`);
    const leftover = attrs.replace(/\s([a-zA-Z-]+)="([^"]*)"/g, (all, k, v) => {
      assert.ok(ATTRS.has(k.toLowerCase()), `attribute ${k} from ${JSON.stringify(input)}`);
      const val = v.replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/\s/g, '').toLowerCase();
      if (k === 'href') assert.ok(/^(https?:|mailto:|\/|#)/.test(val), `href ${v} from ${JSON.stringify(input)}`);
      if (k === 'style') assert.match(val, /^text-align:(left|right|center)$/);
      return '';
    });
    assert.equal(leftover.replace(/\s/g, ''), '', `unquoted attribute text "${leftover}" in <${name}> from ${JSON.stringify(input)}`);
    rest = rest.replace(m[0], '');
  }
  assert.ok(!/[<>]/.test(rest), `stray angle bracket in ${JSON.stringify(html)}`);
}

const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '[click](javascript:alert(1))',
  '[click](JaVaScRiPt:alert(1))',
  '[click]( javascript:alert(1))',
  '[x](data:text/html;base64,PHNjcmlwdD4=)',
  '[x](https://a.com" onmouseover="alert(1))',
  "[x](https://a.com' onmouseover='alert(1))",
  '[a](https://x.com) foo_ bar _baz_ [b](https://y.com)',
  '**[a](https://x.com/**) x**',
  'https://x.com/"><img src=x onerror=alert(1)>',
  'https://x.com/_a_/`b` <svg onload=alert(1)>',
  '```js"><img src=x onerror=alert(1)>\ncode\n```',
  '```\n</code></pre><script>alert(1)</script>\n```',
  '| a | b |\n|:-|-:|\n| <b>x</b> | [y](javascript:1) |',
  '> <iframe src=javascript:alert(1)>',
  '- item <a href="javascript:alert(1)">x</a>\n  - sub <img src=x>',
  '\u00000\u0000 `code` \u00001\u0000',
  '[a](https://x.com)[b](https://y.com)_[c](https://z.com)_',
  '# heading <style>*{}</style>',
  '~~<b>~~ **<i>** _<u>_',
];

test('chat markdown renderer: escaped text, allow-listed markup and safe links only', () => {
  for (const p of PAYLOADS) assertSafeHtml(renderMarkdown(p), p);
  // Random fuzz from markdown-significant characters.
  const alphabet = ['<', '>', '"', "'", '`', '*', '_', '~', '[', ']', '(', ')', '|', '#', '-', '\n', ' ', 'a', 'https://x.com/', 'javascript:', 'onerror=', '&', ';', '```', '> ', '1. '];
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 3000; i++) {
    let s = '';
    const n = 1 + Math.floor(rnd() * 40);
    for (let j = 0; j < n; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    assertSafeHtml(renderMarkdown(s), s);
  }
});

test('web helpers: escapeHtml and the symbol-key check used before innerHTML / setSymbol', () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('1')">&`), '&lt;img src=x onerror=&quot;a(&#39;1&#39;)&quot;&gt;&amp;');
  for (const ok of ['delta:BTCUSD', 'linear:BTCUSDT', 'BTCUSDT', 'delta:C-BTC-90000-310125', 'spot:1000PEPEUSDT']) assert.ok(SYMBOL_KEY_RE.test(ok), ok);
  for (const bad of ['<img src=x>', 'delta:<b>', 'delta:..', 'delta:BTC USD', 'delta:BTC"', 'a:b:c', '']) assert.ok(!SYMBOL_KEY_RE.test(bad), bad);
});
