// util.js — small, dependency-free helpers shared across peerit.
// Pure logic only (no DOM) so it can be unit-tested under Node.

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz'

// Monotonic-ish unique id: time prefix (base36) + randomness. Sorts roughly by
// creation time when compared lexically, which is handy for fallback ordering.
export function uid (rand = Math.random) {
  const t = Date.now().toString(36).padStart(9, '0')
  let r = ''
  for (let i = 0; i < 8; i++) r += B36[Math.floor(rand() * 36)]
  return t + r
}

// Inverted timestamp string: newer => smaller, so ascending key scans yield
// reverse-chronological order. 13 digits covers dates well past year 5000.
export function invTs (ms = Date.now()) {
  return String(9999999999999 - ms).padStart(13, '0')
}

export function clamp (n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }

// Community slug rules: lowercase letters, digits, underscores; 2-24 chars.
export function normalizeSlug (s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24)
}
export function isValidSlug (s) {
  return typeof s === 'string' && /^[a-z0-9_]{2,24}$/.test(s)
}

export function shortKey (k, n = 6) {
  if (!k) return '?'
  const s = String(k)
  return s.length <= n * 2 ? s : s.slice(0, n) + '…' + s.slice(-4)
}

// Reddit-style relative time.
export function timeAgo (ms, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - ms) / 1000))
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago')
  const h = Math.floor(m / 60)
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago')
  const d = Math.floor(h / 24)
  if (d < 30) return d + (d === 1 ? ' day ago' : ' days ago')
  const mo = Math.floor(d / 30)
  if (mo < 12) return mo + (mo === 1 ? ' month ago' : ' months ago')
  const y = Math.floor(d / 365)
  return y + (y === 1 ? ' year ago' : ' years ago')
}

// Compact score: 12500 -> "12.5k".
export function fmtCount (n) {
  n = Number(n) || 0
  const abs = Math.abs(n)
  if (abs < 1000) return String(n)
  if (abs < 1000000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace(/\.0$/, '') + 'k'
  return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'm'
}

export function escapeHtml (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Deterministic pastel color from a string (used for avatar/community tints).
export function colorFor (str) {
  let h = 0
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return 'hsl(' + (h % 360) + ' 62% 55%)'
}

// Parse a hash route like "#/r/foo/comments/abc?sort=top" into
// { path:['r','foo','comments','abc'], query:{sort:'top'} }.
export function parseRoute (hash) {
  const raw = String(hash || '').replace(/^#/, '') || '/'
  const [p, q] = raw.split('?')
  const path = p.split('/').filter(Boolean).map(decodeURIComponent)
  const query = {}
  if (q) {
    for (const part of q.split('&')) {
      if (!part) continue
      const [k, v = ''] = part.split('=')
      query[decodeURIComponent(k)] = decodeURIComponent(v)
    }
  }
  return { path, query }
}

export function buildRoute (path, query) {
  let h = '#/' + (Array.isArray(path) ? path : [path]).map(encodeURIComponent).join('/')
  const q = query && Object.keys(query).filter(k => query[k] != null && query[k] !== '')
  if (q && q.length) h += '?' + q.map(k => k + '=' + encodeURIComponent(query[k])).join('&')
  return h
}

export function debounce (fn, ms) {
  let t = null
  return function (...args) {
    clearTimeout(t)
    t = setTimeout(() => fn.apply(this, args), ms)
  }
}
