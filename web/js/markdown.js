// markdown.js — a small, SAFE markdown renderer for user-generated post and
// comment bodies. Everything is HTML-escaped first; we never emit raw user
// HTML. Only http(s)://, hyper://, pear:// and #/ (in-app) links are allowed.

import { escapeHtml } from './util.js'

const SAFE_LINK = /^(https?:\/\/|hyper:\/\/|pear:\/\/|#\/|\/)/i

function safeHref (url) {
  const u = String(url || '').trim()
  if (SAFE_LINK.test(u)) return u
  return null
}

// Inline: code spans, bold, italic, strikethrough, explicit links, autolinks.
function inline (text) {
  let s = escapeHtml(text)

  // `code`
  s = s.replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>')

  // [label](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const href = safeHref(url)
    if (!href) return label
    const ext = /^https?:/i.test(href)
    return '<a href="' + href + '"' + (ext ? ' target="_blank" rel="noopener noreferrer nofollow"' : '') + '>' + label + '</a>'
  })

  // bare autolinks (avoid touching ones already inside an href="...")
  s = s.replace(/(^|[\s(])((?:https?|hyper|pear):\/\/[^\s<)]+)/g, (m, pre, url) => {
    const href = safeHref(url)
    if (!href) return m
    const ext = /^https?:/i.test(href)
    return pre + '<a href="' + href + '"' + (ext ? ' target="_blank" rel="noopener noreferrer nofollow"' : '') + '>' + url + '</a>'
  })

  // **bold**, *italic*/_italic_, ~~strike~~
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')

  return s
}

export function renderMarkdown (src) {
  const text = String(src == null ? '' : src).replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const out = []
  let i = 0

  const flushParagraph = (buf) => {
    if (buf.length) out.push('<p>' + inline(buf.join('\n')).replace(/\n/g, '<br>') + '</p>')
    buf.length = 0
  }
  const para = []

  while (i < lines.length) {
    const line = lines[i]

    // fenced code block ```
    if (/^```/.test(line)) {
      flushParagraph(para)
      const code = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++ }
      i++ // skip closing fence
      out.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>')
      continue
    }

    // headings #..######
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flushParagraph(para)
      const lvl = h[1].length
      out.push('<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>')
      i++; continue
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph(para)
      out.push('<hr>')
      i++; continue
    }

    // blockquote (collapse consecutive > lines)
    if (/^>\s?/.test(line)) {
      flushParagraph(para)
      const quote = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++ }
      out.push('<blockquote>' + renderMarkdown(quote.join('\n')) + '</blockquote>')
      continue
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph(para)
      const items = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push('<li>' + inline(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>'); i++
      }
      out.push('<ul>' + items.join('') + '</ul>')
      continue
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph(para)
      const items = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push('<li>' + inline(lines[i].replace(/^\s*\d+\.\s+/, '')) + '</li>'); i++
      }
      out.push('<ol>' + items.join('') + '</ol>')
      continue
    }

    // blank line ends a paragraph
    if (/^\s*$/.test(line)) { flushParagraph(para); i++; continue }

    para.push(line)
    i++
  }
  flushParagraph(para)
  return out.join('\n')
}

// Plain-text excerpt (for feed previews / meta descriptions).
export function excerpt (src, n = 220) {
  const s = String(src || '')
    .replace(/[`*_~#>\-]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s
}
