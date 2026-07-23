#!/usr/bin/env node
// build-landing-learn.mjs — generate the SEO/LLM-crawlable static mirror of the
// Learn hub onto the landing site (p2pbuilders.com):
//
//   landing/learn/index.html      hub index (ItemList JSON-LD)
//   landing/learn/<id>.html       one page per lesson (TechArticle JSON-LD,
//                                 canonical, OG/Twitter meta, prev/next)
//   landing/sitemap.xml           all landing pages
//   landing/llms.txt              llms.txt convention: map of the site for LLMs
//   landing/llms-full.txt         entire learn corpus as one markdown document
//
// The app itself is a hash-routed P2P site (hyper://) that crawlers can't see —
// this static mirror is what search engines and AI crawlers index. Re-run after
// editing web/js/learn-content.js and commit the output:
//
//   node scripts/build-landing-learn.mjs
//
import { mkdirSync, writeFileSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { SECTIONS, LESSONS, lessonsBySection, numberedLessons } from '../web/js/learn-content.js'
import { renderMarkdown, excerpt } from '../web/js/markdown.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dir, '..')
const OUT = join(ROOT, 'landing', 'learn')
const BASE = process.env.BASE_URL || 'https://p2pbuilders.com'
const PEAR_LINK = 'pear://dqz1e6fwyrz1mxj7eqsmcar3hnegrj491t5hnqjm9mda9tz8dzfy'
const GITHUB = 'https://github.com/bigdestiny2/p2pbuilders'

mkdirSync(OUT, { recursive: true })

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Rewrite in-app links (#/learn/<id>) to static page links so crawlers can walk
// the whole corpus.
function rewriteLinks (html) {
  return html.replace(/href="#\/learn\/([a-z0-9-]+)"/g, 'href="/learn/$1.html"')
    .replace(/href="#\/learn"/g, 'href="/learn/"')
    .replace(/href="#\/[^"]*"/g, 'href="/"')
}

// Shared shell reusing the landing design language (self-contained CSS, no JS,
// no tracking — consistent with the rest of the site).
const CSS = `
:root{--bg:#f6f6ef;--fg:#0b0f14;--dim:#555;--faint:#828282;--orange:#ff6600;--border:#e0e0d2;--code-bg:#ebebe1}
@media (prefers-color-scheme:dark){:root{--bg:#14130e;--fg:#ebe7d7;--dim:#aaa69a;--faint:#7a7568;--orange:#ff7a1a;--border:#2c2a22;--code-bg:#1b1a15}}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);font-family:Verdana,Geneva,sans-serif;line-height:1.6;-webkit-text-size-adjust:100%}
a{color:var(--fg)}a:hover{color:var(--orange)}
header{background:var(--orange);padding:6px 12px}header .bar{max-width:760px;margin:0 auto;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
header .brand{color:#000;font-weight:700;font-size:14px;text-decoration:none}
header .nav{display:flex;gap:12px;font-size:13px}header .nav a{color:#000;text-decoration:none}header .nav a:hover{text-decoration:underline}
main{max-width:760px;margin:0 auto;padding:24px 16px 80px;font-size:15px}
h1{font-size:24px;margin:0 0 6px;line-height:1.25}h2{font-size:18px;margin:28px 0 8px}h3{font-size:15.5px;margin:20px 0 6px}
.crumbs{font-size:12.5px;color:var(--faint);margin-bottom:14px}.crumbs a{color:var(--faint)}
.meta{color:var(--dim);font-size:13px;margin:2px 0 18px}
code,pre{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:13px}
code{background:var(--code-bg);padding:1px 5px;border-radius:3px}
pre{background:var(--code-bg);padding:10px 12px;border-radius:4px;border:1px solid var(--border);overflow-x:auto;line-height:1.5;margin:10px 0}
pre code{background:transparent;padding:0}
blockquote{border-left:3px solid var(--orange);margin:10px 0;padding:2px 14px;color:var(--dim)}
table{border-collapse:collapse;margin:12px 0;font-size:13.5px}th,td{border:1px solid var(--border);padding:5px 10px;text-align:left}
ul,ol{padding-left:22px}
.toc{list-style:none;padding:0}.toc li{padding:7px 0;border-top:1px solid var(--border)}.toc li a{font-weight:700;text-decoration:none}
.toc .tt{color:var(--faint);font-size:13px}
.sec{margin:26px 0}.sec>p{color:var(--dim);font-size:13.5px;margin:2px 0 6px}
.pager{display:flex;justify-content:space-between;gap:14px;margin-top:34px;padding-top:14px;border-top:1px solid var(--border);font-size:13.5px}
.pager a{color:var(--dim);text-decoration:none;max-width:48%}.pager a:hover{color:var(--orange)}
.cta{display:inline-block;margin:6px 8px 0 0;padding:8px 14px;background:var(--orange);color:#000;text-decoration:none;font-weight:700;border-radius:4px;font-size:13.5px}
footer{max-width:760px;margin:40px auto 20px;padding:24px 16px 0;border-top:1px solid var(--border);font-size:12px;color:var(--faint);line-height:1.8}
footer a{color:var(--faint)}
`.trim()

function shell ({ title, description, canonical, body, jsonld, ogType = 'article' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#ff6600">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${ogType}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="p2pbuilders">
<meta property="og:image" content="${BASE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${BASE}/og.png">
<script type="application/ld+json">${jsonld}</script>
<style>${CSS}</style>
</head>
<body>
<header><div class="bar">
  <a class="brand" href="/">p2pbuilders</a>
  <nav class="nav">
    <a href="/learn/">learn</a>
    <a href="/#board">board</a>
    <a href="/#join">join</a>
    <a href="${GITHUB}">github</a>
  </nav>
</div></header>
<main>
${body}
</main>
<footer>
<p>no cookies. no tracking. no accounts. no server. this page is static; it calls nothing home.</p>
<p><a href="/">p2pbuilders</a> · <a href="/learn/">learn index</a> · <a href="/llms.txt">llms.txt</a> · <a href="${GITHUB}">github</a> · <a href="https://docs.pears.com">pear runtime</a></p>
<p>run the board: <code>pear run ${PEAR_LINK.slice(0, 24)}…</code></p>
</footer>
</body>
</html>
`
}

const org = { '@type': 'Organization', name: 'p2pbuilders', url: BASE, sameAs: [GITHUB] }
const flat = numberedLessons()
const today = new Date().toISOString().slice(0, 10)

// ---- per-lesson pages -------------------------------------------------------
for (let i = 0; i < flat.length; i++) {
  const l = flat[i]
  const section = SECTIONS.find(s => s.id === l.section)
  const canonical = `${BASE}/learn/${l.id}.html`
  const prev = i > 0 ? flat[i - 1] : null
  const next = i < flat.length - 1 ? flat[i + 1] : null
  const contentHtml = rewriteLinks(renderMarkdown(l.body))
  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        headline: l.title,
        description: l.summary,
        url: canonical,
        inLanguage: 'en',
        isPartOf: { '@type': 'WebSite', name: 'p2pbuilders', url: BASE },
        articleSection: section ? section.title : l.section,
        timeRequired: `PT${l.minutes}M`,
        author: org,
        publisher: org,
        dateModified: today,
        isAccessibleForFree: true
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'p2pbuilders', item: BASE + '/' },
          { '@type': 'ListItem', position: 2, name: 'Learn', item: BASE + '/learn/' },
          { '@type': 'ListItem', position: 3, name: l.title, item: canonical }
        ]
      }
    ]
  })
  const body = `
<nav class="crumbs"><a href="/learn/">learn</a> › ${esc(section ? section.title : l.section)}</nav>
<article>
<div class="meta">${l.minutes} min read · part of <strong>${esc(section ? section.title : l.section)}</strong> · also readable inside the app (type <code>learn ${esc(l.id)}</code> in the terminal, or the learn tab in the browser build)</div>
${contentHtml}
</article>
<nav class="pager">
${prev ? `<a rel="prev" href="/learn/${prev.id}.html">« ${esc(prev.title)}</a>` : '<span></span>'}
${next ? `<a rel="next" href="/learn/${next.id}.html">${esc(next.title)} »</a>` : ''}
</nav>`
  writeFileSync(join(OUT, l.id + '.html'), shell({
    title: `${l.title} — p2pbuilders learn`,
    description: l.summary,
    canonical,
    body,
    jsonld
  }))
}

// ---- learn index ------------------------------------------------------------
{
  const canonical = `${BASE}/learn/`
  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Learn peer-to-peer — the p2pbuilders education hub',
    description: 'Free P2P engineering education: a 7-day field manual, Holepunch walkthroughs (Pear, Hypercore, Hyperswarm, Autobase), beginner lesson tracks, ecosystem war stories, build articles and app patterns.',
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'p2pbuilders', url: BASE },
    publisher: org,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: flat.map((l, i) => ({
        '@type': 'ListItem', position: i + 1, name: l.title, url: `${BASE}/learn/${l.id}.html`
      }))
    }
  })
  const sections = lessonsBySection().filter(g => g.lessons.length).map(({ section, lessons }) => `
<section class="sec">
<h2>${esc(section.title)}</h2>
<p>${esc(section.blurb)}</p>
<ul class="toc">
${lessons.map(l => `<li><a href="/learn/${l.id}.html">${esc(l.title)}</a> <span class="tt">— ${esc(l.summary)} (${l.minutes} min)</span></li>`).join('\n')}
</ul>
</section>`).join('\n')
  const body = `
<h1>learn peer-to-peer</h1>
<p class="meta">${flat.length} free lessons · no signup, no tracking · the same content ships inside the <a href="/">p2pbuilders app</a> and replicates peer-to-peer</p>
<p>Everything we know about building serverless, permissionless software on the
<a href="https://docs.pears.com">Pear / Holepunch</a> stack: distributed hash tables, append-only logs,
NAT traversal, binary protocols, cryptography, and the app patterns that make it all usable.</p>
<p><a class="cta" href="/learn/${flat[0].id}.html">start the 7-day field manual</a> <a class="cta" href="/#join">join the board</a></p>
${sections}`
  writeFileSync(join(OUT, 'index.html'), shell({
    title: 'Learn peer-to-peer — free P2P engineering lessons | p2pbuilders',
    description: 'Free P2P engineering education: a 7-day crash course (Kademlia to profiling), Holepunch walkthroughs — Pear, Hypercore, Hyperswarm, Autobase — beginner tracks, war stories and app patterns.',
    canonical,
    body,
    jsonld,
    ogType: 'website'
  }))
}

// ---- sitemap.xml ------------------------------------------------------------
{
  const urls = [
    { loc: BASE + '/', pri: '1.0' },
    { loc: BASE + '/learn/', pri: '0.9' },
    ...flat.map(l => ({ loc: `${BASE}/learn/${l.id}.html`, pri: '0.7' }))
  ]
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><priority>${u.pri}</priority></url>`).join('\n') +
    '\n</urlset>\n'
  writeFileSync(join(ROOT, 'landing', 'sitemap.xml'), xml)
}

// ---- llms.txt + llms-full.txt ----------------------------------------------
{
  const groups = lessonsBySection().filter(g => g.lessons.length)
  const llms = `# p2pbuilders

> A permissionless, peer-to-peer Hacker News for people who build P2P software.
> No servers, no accounts: every user is a keypair, every post is a signed
> append-only log entry, spam is limited by proof-of-work and
> reputation-weighted voting, and always-on availability comes from the
> HiveRelay pinning fleet. Built on the Pear / Holepunch stack (Hypercore,
> Hyperswarm, Hyperbee, Hyperdrive, Bare). It also ships a free education hub:
> ${flat.length} lessons on P2P engineering.

Run the board in a terminal: \`pear run ${PEAR_LINK}\`
Browser build (PearBrowser P2P site): see ${GITHUB}/tree/main/web
Full learn corpus in one file: ${BASE}/llms-full.txt

## Learn — P2P engineering lessons

${groups.map(({ section, lessons }) =>
    `### ${section.title}\n\n${section.blurb}\n\n` +
    lessons.map(l => `- [${l.title}](${BASE}/learn/${l.id}.html): ${l.summary}`).join('\n')
  ).join('\n\n')}

## Project

- [About + manifesto](${BASE}/): what p2pbuilders is and how to join
- [README](${GITHUB}#readme): full documentation
- [SPEC](${GITHUB}/blob/main/SPEC.md): op schema, PoW parameters, reputation math, sybil analysis
- [Pear runtime docs](https://docs.pears.com): the P2P runtime this runs on
`
  writeFileSync(join(ROOT, 'landing', 'llms.txt'), llms)

  const full = `# p2pbuilders — the complete Learn corpus

> ${flat.length} lessons on peer-to-peer engineering from the p2pbuilders
> project (${BASE}). License: Apache-2.0. Attribution appreciated:
> link to ${BASE}/learn/ when quoting.

` + groups.map(({ section, lessons }) =>
    `\n---\n\n# SECTION: ${section.title}\n\n${section.blurb}\n` +
    lessons.map(l => `\n---\n\n<!-- lesson: ${l.id} · ${BASE}/learn/${l.id}.html -->\n\n${l.body.trim()}\n`).join('')
  ).join('')
  writeFileSync(join(ROOT, 'landing', 'llms-full.txt'), full)
}

// ---- robots.txt -------------------------------------------------------------
{
  const robots = `# p2pbuilders — everything here is public and free to index.
# AI crawlers are welcome: the learn corpus is Apache-2.0, attribution
# appreciated (link ${BASE}/learn/). Machine-readable map: /llms.txt

User-agent: *
Allow: /

Sitemap: ${BASE}/sitemap.xml
`
  writeFileSync(join(ROOT, 'landing', 'robots.txt'), robots)
}

console.log(`[landing-learn] wrote ${flat.length} lesson pages + index, sitemap.xml, robots.txt, llms.txt, llms-full.txt`)
console.log('[landing-learn] base url:', BASE, '(override with BASE_URL=)')
