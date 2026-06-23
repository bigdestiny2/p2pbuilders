// app.js — p2pbuilders UI. A Hacker-News-style front end over the reused gossip
// engine. Hash router + event delegation; PoW minting shows live progress; votes
// are reputation-weighted; boards, profiles, follow/block, and subscribable
// blocklists are all here. Runs identically on the PearBrowser bridge and the
// localStorage dev-fallback.

import { createSync } from './sync.js'
import { createIdentity } from './identity.js'
import { createData } from './data.js'
import { Prefs } from './prefs.js'
import { makeValidator, MIN_BITS } from './pow.js'
import { renderMarkdown } from './markdown.js'
import { sortPosts, sortComments, POST_SORTS, COMMENT_SORTS } from './ranking.js'
import { buildCommentTree, sortCommentTree, countDescendants, DEFAULT_BOARD, normalizeBoard } from './model.js'
import { escapeHtml as esc, timeAgo, fmtCount, parseRoute, buildRoute, shortKey, colorFor, debounce } from './util.js'

let sync, identity, data, prefs
let renderToken = 0
let _lastHash = ''
const openReplies = new Set()
const nameCache = new Map()

const $ = (s, r = document) => r.querySelector(s)
const app = () => $('#app')
const nameOf = (pub) => nameCache.get(pub) || ('anon-' + String(pub || '?').slice(0, 6))
async function primeNames (pubs) {
  await Promise.all([...new Set(pubs)].filter(p => p && !nameCache.has(p)).map(async p => nameCache.set(p, await data.nickOf(p))))
}
function domainOf (url) { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null } }
function safeUrl (u) { return /^(https?:\/\/|hyper:\/\/|pear:\/\/)/i.test(String(u || '')) ? u : null }

// ---- boot -------------------------------------------------------------------
async function boot () {
  identity = createIdentity()
  await identity.ready()
  sync = createSync({ getMe: () => identity.me().pubkey, identity, validate: makeValidator(MIN_BITS) })
  await sync.ready()
  data = createData(sync, identity, { minBits: MIN_BITS })
  refreshPrefs()

  const soft = debounce(() => {
    const a = document.activeElement
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return
    if (a && a !== document.body && app() && app().contains(a)) return
    route()
  }, 350)
  sync.onChange(soft)
  sync.onChange(() => updateNetStatus())
  setInterval(updateNetStatus, 3000)

  window.addEventListener('hashchange', route)
  document.addEventListener('click', onClick)
  document.addEventListener('submit', onSubmit)
  document.addEventListener('change', onChange)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { const d = $('#userdrop'); if (d && !d.hidden) { d.hidden = true; const b = $('[data-act="toggle-usermenu"]'); if (b) b.setAttribute('aria-expanded', 'false') } }
  })

  renderChrome()
  if (!location.hash) location.hash = '#/'
  route()
}
function refreshPrefs () { prefs = new Prefs(typeof localStorage !== 'undefined' ? localStorage : null, identity.me().pubkey) }

// ---- chrome -----------------------------------------------------------------
function renderChrome () {
  document.body.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/"><span class="brand-mark">Y</span><span class="brand-name">p2pbuilders</span></a>
      <nav class="topnav">
        <a href="#/">new</a><a href="#/?sort=hot">hot</a><a href="#/?sort=top">top</a>
        <a href="#/boards">boards</a><a href="#/submit">submit</a>
      </nav>
      <form class="search" data-form="search"><input name="q" placeholder="search" autocomplete="off"></form>
      <div class="usermenu" id="usermenu"></div>
    </header>
    <main class="wrap"><section id="app"></section></main>
    <div id="toasts" class="toasts"></div>
    <button id="netstatus" class="netstatus" data-act="netstatus" title="P2P sync status">…</button>`
  renderUserMenu(); updateNetStatus()
}

async function renderUserMenu () {
  const me = identity.me(); await primeNames([me.pubkey])
  const el = $('#usermenu'); if (!el) return
  el.innerHTML = `
    <button class="user-pill" data-act="toggle-usermenu" aria-haspopup="menu" aria-label="Account menu">
      <span class="avatar" style="background:${colorFor(me.pubkey)}"></span><span class="uname">${esc(nameOf(me.pubkey))}</span>
    </button>
    <div class="dropdown" id="userdrop" role="menu" hidden>
      <a role="menuitem" href="#/u/${esc(me.pubkey)}">profile</a>
      <a role="menuitem" href="#/submit">submit</a>
      <a role="menuitem" href="#/boards">boards</a>
      <a role="menuitem" href="#/blocklists">blocklists</a>
      <a role="menuitem" href="#/settings">settings</a>
      ${identity.isDev ? '<div class="dd-sep"></div>' + devSwitcher() : ''}
    </div>`
}
function devSwitcher () {
  const me = identity.me().pubkey
  return '<div class="dd-label">dev: switch user</div>' + identity.listUsers().map(u =>
    `<button class="dd-user ${u.pubkey === me ? 'active' : ''}" data-act="switch-user" data-pub="${esc(u.pubkey)}"><span class="avatar sm" style="background:${colorFor(u.pubkey)}"></span>${esc(u.label || ('anon-' + u.pubkey.slice(0, 6)))}</button>`
  ).join('') + '<button class="dd-user new" data-act="new-user">+ new dev user</button>'
}

async function updateNetStatus () {
  const el = $('#netstatus'); if (!el || !sync) return
  try {
    const s = await sync.status(); const me = identity.me(); const secure = s.secure !== false
    el.className = 'netstatus ' + (String(s.mode || '').includes('bridge') ? 'bridge' : (secure ? 'ok' : 'warn'))
    el.innerHTML = `<b>${esc(s.mode || 'sync')}</b> · ${s.peers != null ? s.peers : 1}p · ${s.viewLength || 0} recs · <span class="mono">${esc((me.pubkey || '').slice(0, 6))}</span>${secure ? '' : ' ⚠'}`
  } catch (e) { el.textContent = 'sync error' }
}

// ---- router -----------------------------------------------------------------
function route () {
  const { path, query } = parseRoute(location.hash)
  const token = ++renderToken
  const guard = h => { if (token === renderToken) app().innerHTML = h }
  if (location.hash !== _lastHash) { _lastHash = location.hash; try { window.scrollTo(0, 0) } catch {} }
  if (path.length === 0) return viewFeed({ board: query.board || 'all', query, guard, token })
  switch (path[0]) {
    case 'b':
      if (path[2] === 'item' && path[3]) return viewItem({ board: path[1], cid: path[3], query, guard, token })
      return viewFeed({ board: path[1], query, guard, token })
    case 'boards': return viewBoards({ guard, token })
    case 'submit': return viewSubmit({ query, guard, token })
    case 'u': return viewProfile({ pub: path[1], guard, token })
    case 'settings': return viewSettings({ guard, token })
    case 'blocklists': return viewBlocklists({ guard, token })
    case 'search': return viewSearch({ query, guard, token })
    default: return guard(notFound())
  }
}

// ---- feed -------------------------------------------------------------------
async function viewFeed ({ board, query, guard, token }) {
  const sort = query.sort || prefs.sort || 'hot'
  guard(skeleton())
  let posts = board === 'all' ? await data.listAllPosts() : await data.listPostsIn(board)
  const blocked = await data.blockedSet([], prefs.blocklistSubs())
  posts = posts.filter(p => !p.deleted && !blocked.has(p.author) && !prefs.isHidden(p.board + '/' + p.cid))
  posts = await data.withTallies(posts)
  await primeNames(posts.map(p => p.author))
  const counts = await commentCounts(posts)
  if (token !== renderToken) return
  prefs.setSort(sort)
  const ranked = sortPosts(posts, sort)
  const tabs = `<div class="sorttabs">` + POST_SORTS.map(s => `<a class="${s === sort ? 'active' : ''}" href="${buildRoute(board === 'all' ? [] : ['b', board], { ...query, sort: s, board: board === 'all' ? 'all' : undefined })}">${s}</a>`).join('') + `</div>`
  const head = `<div class="feed-head"><h1>${board === 'all' ? 'all builders' : 'b/' + esc(board)}</h1>${tabs}</div>`
  let body
  if (!ranked.length) {
    body = `<div class="empty"><p>No posts yet.</p><a class="btn" href="#/submit">Submit the first one</a> <button class="btn ghost" data-act="seed-demo">load demo</button></div>`
  } else {
    body = `<ol class="feed" start="1">` + ranked.map((p, i) => postRow(p, i + 1, counts)).join('') + `</ol>`
  }
  guard(head + body)
}

function postRow (p, rank, counts) {
  const ref = p.board + '/' + p.cid
  const link = safeUrl(p.url)
  const permalink = buildRoute(['b', p.board, 'item', p.cid])
  const dom = link ? domainOf(link) : null
  const cc = counts ? (counts.get(p.cid) || 0) : 0
  const t = p.tally || { score: 0, myVote: 0 }
  return `<li class="post" data-cid="${esc(p.cid)}" data-board="${esc(p.board)}" data-type="post">
    <span class="rank">${rank}</span>
    <button class="arrow ${t.myVote === 1 ? 'on' : ''}" data-act="vote" data-dir="1" aria-label="upvote">▲</button>
    <div class="post-main">
      <div class="title-line">
        <a class="post-title" href="${link ? esc(link) : permalink}"${link ? ' target="_blank" rel="noopener noreferrer nofollow"' : ''}>${esc(p.title)}</a>
        ${dom ? `<span class="domain">(${esc(dom)})</span>` : ''}
      </div>
      <div class="subline">
        <span class="score">${fmtCount(t.score)} ${Math.abs(t.score) === 1 ? 'point' : 'points'}</span>
        by <a href="#/u/${esc(p.author)}">${esc(nameOf(p.author))}</a>
        <span class="dim">${timeAgo(p.createdAt)}</span>
        <span class="sep">|</span> <a href="#/b/${esc(p.board)}">b/${esc(p.board)}</a>
        <span class="sep">|</span> <a href="${permalink}">${cc} comment${cc === 1 ? '' : 's'}</a>
        <span class="sep">|</span> <button class="linkact" data-act="hide" data-ref="${esc(ref)}">${prefs.isHidden(ref) ? 'unhide' : 'hide'}</button>
        ${p.author === identity.me().pubkey ? `<span class="sep">|</span> <button class="linkact danger" data-act="delete-post">delete</button>` : ''}
      </div>
    </div>
  </li>`
}

async function commentCounts (posts) {
  const m = new Map()
  await Promise.all(posts.map(async p => m.set(p.cid, await sync.count('comment!' + p.cid + '!'))))
  return m
}

// ---- item (post + comments) -------------------------------------------------
async function viewItem ({ board, cid, query, guard, token }) {
  guard(skeleton())
  const post = await data.getPost(board, cid)
  if (!post) return guard(notFound('That post is gone.'))
  const csort = query.csort || 'best'
  const [pw] = await data.withTallies([post])
  let comments = (await data.listComments(cid)).filter(Boolean)
  comments = await data.withTallies(comments)
  await primeNames([post.author, ...comments.map(c => c.author)])
  const { roots } = buildCommentTree(comments)
  const sorted = sortCommentTree(roots, ns => sortComments(ns, csort))
  if (token !== renderToken) return
  const link = safeUrl(post.url); const dom = link ? domainOf(link) : null
  const t = pw.tally
  const mine = post.author === identity.me().pubkey
  const total = roots.reduce((n, r) => n + 1 + countDescendants(r), 0)
  const csortTabs = COMMENT_SORTS.map(s => `<a class="${s === csort ? 'active' : ''}" href="${buildRoute(['b', board, 'item', cid], { csort: s })}">${s}</a>`).join(' ')

  guard(`<article class="item">
    <div class="item-head">
      <button class="arrow ${t.myVote === 1 ? 'on' : ''}" data-cid="${esc(cid)}" data-board="${esc(board)}" data-type="post" data-act="vote" data-dir="1" aria-label="upvote">▲</button>
      <div>
        <h1 class="item-title">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer nofollow">${esc(post.title)}</a>` : esc(post.title)} ${dom ? `<span class="domain">(${esc(dom)})</span>` : ''}</h1>
        <div class="subline"><span class="score">${fmtCount(t.score)} points</span> by <a href="#/u/${esc(post.author)}">${esc(nameOf(post.author))}</a> <span class="dim">${timeAgo(post.createdAt)}${post.editedAt ? ' · edited' : ''}</span> <span class="sep">|</span> <a href="#/b/${esc(board)}">b/${esc(board)}</a>
          ${mine ? `<span class="sep">|</span> <button class="linkact danger" data-act="delete-post">delete</button>` : ''}</div>
      </div>
    </div>
    ${post.deleted ? '<p class="removed">[deleted]</p>' : (post.text ? `<div class="item-text md">${renderMarkdown(post.text)}</div>` : '')}
    <form class="composer" data-form="comment" data-board="${esc(board)}" data-post="${esc(cid)}" data-parent="">
      <textarea name="body" rows="4" placeholder="add a comment (markdown) — costs a small proof-of-work"></textarea>
      <div class="composer-actions"><button class="btn" type="submit">comment</button></div>
    </form>
    <div class="comment-bar">${total} comments <span class="csort">sort: ${csortTabs}</span></div>
    <div class="comments">${sorted.length ? sorted.map(n => commentNode(n, post, 0)).join('') : '<p class="dim">No comments yet.</p>'}</div>
  </article>`)
}

function commentNode (node, post, depth) {
  const mine = node.author === identity.me().pubkey
  const t = node.tally || { score: 0, myVote: 0 }
  const cidDom = 'c_' + node.cid
  const body = node.deleted ? '<div class="removed">[deleted]</div>' : `<div class="md">${renderMarkdown(node.body)}</div>`
  const kids = countDescendants(node)
  const replyForm = openReplies.has(node.cid)
    ? `<form class="composer reply" data-form="comment" data-board="${esc(node.board || post.board)}" data-post="${esc(post.cid)}" data-parent="${esc(node.cid)}"><textarea name="body" rows="3" placeholder="reply… (proof-of-work)"></textarea><div class="composer-actions"><button class="btn" type="submit">reply</button><button class="btn ghost" type="button" data-act="cancel-reply" data-cid="${esc(node.cid)}">cancel</button></div></form>`
    : ''
  const children = node.children.length ? `<div class="children">${node.children.map(c => commentNode(c, post, depth + 1)).join('')}</div>` : ''
  return `<div class="comment" id="${cidDom}" data-cid="${esc(node.cid)}" data-board="${esc(node.board || post.board)}" data-type="comment">
    <div class="comment-row">
      <button class="collapse" data-act="collapse" data-target="${cidDom}" aria-label="collapse">[–]</button>
      <button class="arrow sm ${t.myVote === 1 ? 'on' : ''}" data-act="vote" data-dir="1" aria-label="upvote">▲</button>
      <div class="comment-body">
        <div class="chead"><a href="#/u/${esc(node.author)}">${esc(nameOf(node.author))}</a> <span class="dim">${fmtCount(t.score)} pts · ${timeAgo(node.createdAt)}${kids ? ' · ' + kids + ' repl' + (kids === 1 ? 'y' : 'ies') : ''}</span></div>
        ${body}
        <div class="cactions">
          ${!node.deleted ? `<button class="linkact" data-act="reply" data-cid="${esc(node.cid)}">reply</button>` : ''}
          ${mine && !node.deleted ? `<button class="linkact danger" data-act="delete-comment" data-cid="${esc(node.cid)}">delete</button>` : ''}
        </div>
        ${replyForm}
      </div>
    </div>${children}
  </div>`
}

// ---- submit -----------------------------------------------------------------
async function viewSubmit ({ query, guard, token }) {
  const boards = await data.listBoards()
  if (token !== renderToken) return
  const to = normalizeBoard(query.to || DEFAULT_BOARD) || DEFAULT_BOARD
  guard(`<div class="panel"><h1>submit</h1>
    <form data-form="submit-post">
      <label>title<input name="title" maxlength="300" required placeholder="Show P2PB: …"></label>
      <label>url <span class="dim">(optional)</span><input name="url" placeholder="https:// or hyper:// or pear://"></label>
      <label>text <span class="dim">(optional, markdown)</span><textarea name="text" rows="6"></textarea></label>
      <label>board<select name="board">${boards.map(b => `<option value="${esc(b.name)}" ${b.name === to ? 'selected' : ''}>b/${esc(b.name)}</option>`).join('')}</select></label>
      <div class="form-actions"><button class="btn" type="submit">submit</button> <a class="btn ghost" href="#/">cancel</a></div>
      <p class="dim small">Submitting mints a proof-of-work (a second or two) — the permissionless spam gate. No account needed.</p>
    </form></div>`)
}

// ---- boards -----------------------------------------------------------------
async function viewBoards ({ guard, token }) {
  guard(skeleton())
  const boards = await data.listBoards()
  await Promise.all(boards.map(async b => { b._count = await sync.count('post!' + b.name + '!') }))
  if (token !== renderToken) return
  boards.sort((a, b) => (b._count || 0) - (a._count || 0))
  guard(`<div class="feed-head"><h1>boards</h1></div>
    <div class="panel"><h2>create a board</h2>
      <form data-form="create-board">
        <label>name <span class="dim">b/</span><input name="name" maxlength="24" placeholder="showp2pb" required><small class="hint">2–24 chars: a–z 0–9 _ · creating a board mints a proof-of-work</small></label>
        <label>description<input name="description" maxlength="300"></label>
        <div class="form-actions"><button class="btn" type="submit">create</button></div>
      </form></div>
    <ul class="board-list">${boards.map(b => `<li><a href="#/b/${esc(b.name)}">b/${esc(b.name)}</a> <span class="dim">${fmtCount(b._count || 0)} posts${b.description ? ' · ' + esc(b.description) : ''}</span></li>`).join('')}</ul>`)
}

// ---- profile ----------------------------------------------------------------
async function viewProfile ({ pub, guard, token }) {
  guard(skeleton())
  const me = identity.me(); const mine = pub === me.pubkey
  const profile = await data.getProfile(pub)
  const act = await data.userActivity(pub)
  const inputs = await data.weightInputsFor(pub)
  const followers = mine ? await data.following(me.pubkey) : []
  await primeNames([pub])
  if (token !== renderToken) return
  const items = [...act.posts.map(p => ({ k: 'post', t: p.createdAt, p })), ...act.comments.map(c => ({ k: 'comment', t: c.createdAt, c }))].sort((a, b) => b.t - a.t).slice(0, 60)
  const isFollowing = followers.includes(pub)
  const feed = items.length ? items.map(it => it.k === 'post'
    ? `<li class="act"><span class="atag">post</span> <a href="${buildRoute(['b', it.p.board, 'item', it.p.cid])}">${esc(it.p.title)}</a> <span class="dim">in b/${esc(it.p.board)} · ${timeAgo(it.p.createdAt)}</span></li>`
    : `<li class="act"><span class="atag">comment</span> on <a href="${buildRoute(['b', it.c.board || 'front', 'item', it.c.postCid])}">${esc(it.c.postTitle || 'a post')}</a> <span class="dim">${timeAgo(it.c.createdAt)}</span><div class="md small">${renderMarkdown(it.c.body)}</div></li>`).join('') : '<li class="dim">No activity yet.</li>'
  guard(`<div class="profile-head">
      <span class="avatar lg" style="background:${colorFor(pub)}"></span>
      <div><h1>${esc(nameOf(pub))}</h1><div class="dim mono small">${esc(shortKey(pub, 10))}</div>
        ${profile && profile.bio ? `<p class="bio">${esc(profile.bio)}</p>` : ''}
        <div class="rep">received upvotes: <b>${fmtCount(inputs[1])}</b> · age: <b>${Math.floor(inputs[0])}d</b> · vote weight: <b>${(Math.log2(1 + inputs[0]) * Math.sqrt(1 + inputs[1]) / 50).toFixed(2)}</b></div>
        ${mine ? '<a class="btn ghost sm" href="#/settings">edit profile</a>' : `<button class="btn ghost sm" data-act="follow" data-pub="${esc(pub)}">${isFollowing ? 'unfollow' : 'follow'}</button> <button class="btn ghost sm" data-act="block" data-pub="${esc(pub)}">block</button>`}
      </div></div>
    <h2 class="section-title">activity</h2><ul class="activity">${feed}</ul>`)
}

// ---- settings ---------------------------------------------------------------
async function viewSettings ({ guard, token }) {
  const me = identity.me(); const p = await data.getProfile(me.pubkey); const st = await data.status()
  if (token !== renderToken) return
  guard(`<div class="panel"><h1>settings</h1>
    <h2>profile</h2>
    <form data-form="profile">
      <label>nickname<input name="nick" maxlength="24" value="${esc((p && p.nick) || '')}" placeholder="pick a handle"></label>
      <label>bio<textarea name="bio" rows="3" maxlength="300">${esc((p && p.bio) || '')}</textarea></label>
      <div class="form-actions"><button class="btn" type="submit">save</button></div>
    </form>
    <h2>identity</h2><p class="mono small">${esc(me.pubkey)}</p>
    <h2>network</h2><ul class="kv"><li><span>mode</span><b>${st.mode}${st.secure === false ? ' (insecure)' : ''}</b></li><li><span>records</span><b>${fmtCount(st.viewLength || 0)}</b></li><li><span>peers</span><b>${st.peers != null ? st.peers : 1}</b></li></ul>
    ${identity.isDev ? `<h2>dev tools</h2><p class="dim small">Open multiple tabs to act as multiple peers.</p><div class="form-actions"><button class="btn ghost" data-act="seed-demo">load demo</button> <button class="btn ghost danger" data-act="wipe">wipe local data</button></div>` : ''}
  </div>`)
}

// ---- blocklists -------------------------------------------------------------
async function viewBlocklists ({ guard, token }) {
  guard(skeleton())
  const lists = await data.listBlocklists()
  await primeNames(lists.map(l => l.author))
  if (token !== renderToken) return
  const me = identity.me().pubkey
  const mine = lists.find(l => l.author === me)
  guard(`<div class="feed-head"><h1>blocklists</h1></div>
    <div class="panel"><h2>publish your blocklist</h2>
      <form data-form="blocklist"><label>blocked pubkeys <span class="dim">(comma/space separated)</span><textarea name="list" rows="3" placeholder="pubkey1 pubkey2 …">${mine ? esc((mine.list || []).join(' ')) : ''}</textarea></label><div class="form-actions"><button class="btn" type="submit">publish</button></div></form>
      <p class="dim small">Others can subscribe to your list to hide those keys. Curate responsibly.</p></div>
    <h2 class="section-title">curators</h2>
    <ul class="board-list">${lists.length ? lists.map(l => `<li><a href="#/u/${esc(l.author)}">${esc(nameOf(l.author))}</a> <span class="dim">${(l.list || []).length} keys · v${l.version || 1}</span> <button class="btn ghost sm" data-act="sub-blocklist" data-pub="${esc(l.author)}">${prefs.isSubscribedBlocklist(l.author) ? 'subscribed' : 'subscribe'}</button></li>`).join('') : '<li class="dim">No published blocklists yet.</li>'}</ul>`)
}

// ---- search -----------------------------------------------------------------
async function viewSearch ({ query, guard, token }) {
  const q = (query.q || '').trim().toLowerCase()
  guard(skeleton())
  if (!q) return guard('<div class="empty"><p>Type a query above.</p></div>')
  let posts = (await data.listAllPosts()).filter(p => !p.deleted && (p.title + ' ' + (p.text || '') + ' ' + (p.url || '')).toLowerCase().includes(q))
  posts = await data.withTallies(posts); await primeNames(posts.map(p => p.author))
  const counts = await commentCounts(posts)
  if (token !== renderToken) return
  guard(`<div class="feed-head"><h1>results for "${esc(q)}"</h1></div><ol class="feed">${posts.length ? sortPosts(posts, 'top').map((p, i) => postRow(p, i + 1, counts)).join('') : '<p class="dim">No matches.</p>'}</ol>`)
}

// ---- helpers ----------------------------------------------------------------
function skeleton () { return '<div class="feed-head"><h1>&nbsp;</h1></div><ol class="feed">' + '<li class="post skel"><span class="rank"></span><span class="sk"></span></li>'.repeat(5) + '</ol>' }
function notFound (m) { return `<div class="empty"><h3>not found</h3><p>${esc(m || 'Nothing here.')}</p><a class="btn" href="#/">home</a></div>` }
function toast (msg, kind = 'ok') { const r = $('#toasts'); if (!r) return; const e = document.createElement('div'); e.className = 'toast ' + kind; e.textContent = msg; r.appendChild(e); setTimeout(() => { e.classList.add('out'); setTimeout(() => e.remove(), 300) }, 2800) }
function parseScore (s) { s = String(s).trim(); const m = parseFloat(s); return /k$/i.test(s) ? m * 1000 : (parseInt(s, 10) || 0) }

// ---- events -----------------------------------------------------------------
async function onClick (e) {
  const t = e.target.closest('[data-act]')
  if (!t) { const d = $('#userdrop'); if (d && !e.target.closest('#usermenu')) d.hidden = true; return }
  const act = t.dataset.act
  try {
    switch (act) {
      case 'vote': return void await onVote(t)
      case 'hide': { prefs.toggleHidden(t.dataset.ref); route(); return }
      case 'collapse': { const n = document.getElementById(t.dataset.target); if (n) { const c = n.classList.toggle('collapsed'); t.textContent = c ? '[+]' : '[–]' } return }
      case 'reply': { openReplies.add(t.dataset.cid); route(); return }
      case 'cancel-reply': { openReplies.delete(t.dataset.cid); route(); return }
      case 'toggle-usermenu': { const d = $('#userdrop'); if (d) { d.hidden = !d.hidden; t.setAttribute('aria-expanded', String(!d.hidden)) } return }
      case 'netstatus': return void updateNetStatus()
      case 'switch-user': { identity.switchUser(t.dataset.pub); if (sync.announce) await sync.announce(); refreshPrefs(); nameCache.clear(); await renderUserMenu(); route(); toast('switched'); return }
      case 'new-user': { const n = prompt('dev user name:', 'anon' + Math.floor(Math.random() * 999)); if (!n) return; await identity.createUser(n); if (sync.announce) await sync.announce(); refreshPrefs(); nameCache.clear(); await renderUserMenu(); route(); return }
      case 'delete-post': { const el = t.closest('[data-board]'); if (confirm('Delete this post?')) { await data.deletePost(el.dataset.board, el.dataset.cid); toast('deleted'); location.hash = '#/' } return }
      case 'delete-comment': { const el = t.closest('.comment'); const { path } = parseRoute(location.hash); if (confirm('Delete this comment?')) { await data.deleteComment(path[3], t.dataset.cid); toast('deleted'); route() } return }
      case 'follow': { const cur = (await data.following(identity.me().pubkey)).includes(t.dataset.pub); await (cur ? data.unfollow(t.dataset.pub) : data.follow(t.dataset.pub)); toast(cur ? 'unfollowed' : 'followed'); route(); return }
      case 'block': { if (confirm('Block ' + nameOf(t.dataset.pub) + '? (also publish publicly?)')) { await data.block(t.dataset.pub, true); toast('blocked'); route() } return }
      case 'sub-blocklist': { const now = prefs.toggleBlocklist(t.dataset.pub); toast(now ? 'subscribed' : 'unsubscribed'); route(); return }
      case 'seed-demo': return void await seedDemo()
      case 'wipe': { if (confirm('Wipe ALL local data?')) { try { Object.keys(localStorage).filter(k => k.startsWith('p2pb:')).forEach(k => localStorage.removeItem(k)); sessionStorage.clear() } catch {} location.reload() } return }
    }
  } catch (err) { toast(err.message || String(err), 'error') }
}

function onChange (e) {
  if (e.target.matches('.sorttabs')) {}
}

async function onVote (t) {
  const box = t.closest('[data-cid]')
  const cid = box.dataset.cid, type = box.dataset.type
  const cur = t.classList.contains('on') ? 1 : 0
  const next = cur === 1 ? 0 : 1
  const scoreEl = box.querySelector('.score')
  const paint = (on) => { t.classList.toggle('on', on === 1) }
  paint(next)
  if (scoreEl) { const base = parseScore(scoreEl.textContent) - cur; scoreEl.textContent = fmtCount(base + next) + (Math.abs(base + next) === 1 ? ' point' : ' points') }
  try { await data.vote(cid, type, next) } catch (err) { paint(cur); throw err }
}

async function onSubmit (e) {
  const form = e.target.closest('form[data-form]'); if (!form) return
  e.preventDefault()
  const f = form.dataset.form; const fd = new FormData(form)
  if (form.dataset.busy) return
  const btn = form.querySelector('button[type="submit"]')
  const setBusy = (label) => { form.dataset.busy = '1'; if (btn) { btn.dataset.label = btn.dataset.label || btn.textContent; btn.disabled = true; btn.textContent = label } }
  const clearBusy = () => { delete form.dataset.busy; if (btn && document.contains(btn)) { btn.disabled = false; btn.textContent = btn.dataset.label } }
  const onProgress = (n) => { if (btn) btn.textContent = 'minting PoW… ' + fmtCount(n) }
  try {
    if (f === 'search') { const q = (fd.get('q') || '').trim(); if (q) location.hash = buildRoute(['search'], { q }); return }
    if (f === 'submit-post') {
      setBusy('minting PoW…')
      const p = await data.submitPost({ board: fd.get('board'), title: fd.get('title'), url: fd.get('url'), text: fd.get('text'), onProgress })
      toast('posted'); location.hash = buildRoute(['b', p.board, 'item', p.cid]); return
    }
    if (f === 'create-board') {
      setBusy('minting PoW…')
      const b = await data.createBoard({ name: fd.get('name'), description: fd.get('description'), onProgress })
      toast('created b/' + b.name); location.hash = '#/b/' + b.name; return
    }
    if (f === 'comment') {
      setBusy('minting PoW…')
      const parent = form.dataset.parent || null
      await data.addComment({ postCid: form.dataset.post, board: form.dataset.board, parentCid: parent, body: fd.get('body'), onProgress })
      if (parent) openReplies.delete(parent)
      toast('commented'); route(); return
    }
    if (f === 'profile') { await data.setProfile({ nick: fd.get('nick'), bio: fd.get('bio') }); data.invalidateProfile(identity.me().pubkey); nameCache.delete(identity.me().pubkey); await renderUserMenu(); toast('saved'); route(); return }
    if (f === 'blocklist') { const list = (fd.get('list') || '').split(/[\s,]+/).filter(Boolean); await data.publishBlocklist(list); toast('blocklist published'); route(); return }
  } catch (err) { toast(err.message || String(err), 'error') }
  finally { clearBusy() }
}

async function seedDemo () {
  toast('seeding…')
  const d = data
  try { await d.createBoard({ name: 'showp2pb' }) } catch {}
  const posts = [
    { board: 'front', title: 'peerit — a peer-to-peer Reddit running in PearBrowser', url: 'hyper://peerit' },
    { board: 'front', title: 'Ask P2PB: how do you keep a Hyperdrive online 24/7?', text: 'HiveRelay pins it for you — dumb always-on storage. What else are people using?' },
    { board: 'showp2pb', title: 'Show P2PB: this very app, ported to the browser', text: 'Same gossip engine as peerit. Posts are PoW-gated and reputation-weighted.' }
  ]
  let first = null
  for (const p of posts) { try { const r = await d.submitPost(p); first = first || r } catch (e) { console.error(e) } }
  if (first) { const c = await d.addComment({ postCid: first.cid, board: first.board, body: 'replicated to you from a peer — no server involved.' }); await d.vote(first.cid, 'post', 1); void c }
  toast('demo ready'); location.hash = '#/'; route()
}

if (typeof window !== 'undefined') window.__p2pb = { get data () { return data }, get sync () { return sync }, route }
if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot() }
export { boot }
