// p2pbuilders frontend — HN-shaped single feed. Vanilla JS, no build step.

import { createTransport } from './transport.js'

const DEFAULT_BOARD = 'front'
const ONBOARD_FLAG = 'p2pbuilders.onboarded'

// Auto-detects environment: Pear IPC pipe if available, else localhost WebSocket.
const rpc = createTransport()

// Cached identity, populated on boot. Used for ownership checks.
let me = null

// ----- helpers -----

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v
    else if (k === 'html') el.innerHTML = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (v !== undefined && v !== null) el.setAttribute(k, v)
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)))
  }
  return el
}
const $view = () => document.getElementById('view')
const shortHex = (s, n = 8) => (s ? s.slice(0, n) : '')
const displayName = (obj) => obj.authorNick || shortHex(obj.author || obj.pubkey)
const isMine = (obj) => me && obj.author && obj.author === me.pubkey

function hostOf (url) {
  try { return new URL(url).host.replace(/^www\./, '') } catch { return null }
}

function ago (ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 45) return `${s} seconds ago`
  if (s < 60 * 45) return `${Math.floor(s / 60)} minutes ago`
  if (s < 60 * 60 * 22) return `${Math.floor(s / 3600)} hours ago`
  const d = Math.floor(s / 86400)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

function render (node) {
  const v = $view(); v.replaceChildren(); v.appendChild(node)
}
function loading (msg = 'loading…') { return h('div', { class: 'empty' }, msg) }
function errorBox (msg) { return h('div', { class: 'err' }, msg) }

function toast (msg, { kind = 'ok', ms = 2400 } = {}) {
  const t = document.createElement('div')
  t.className = `toast toast-${kind}`
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.classList.add('show'), 10)
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400) }, ms)
}
const toastError = (msg) => toast(msg, { kind: 'err', ms: 4000 })

// A small "working on it" pill near an action button. Shows a pulsing progress
// track and the elapsed ms, swapping itself out for a result toast when done.
function powPill (expectedMs = 100, label = 'minting pow') {
  const pill = h('span', { class: 'pow-pill' },
    h('span', { class: 'pow-bar' }, h('span', { class: 'pow-fill' })),
    h('span', { class: 'pow-label' }, `${label}…`)
  )
  const t0 = performance.now()
  const fill = pill.querySelector('.pow-fill')
  const labelEl = pill.querySelector('.pow-label')
  let raf = 0
  const tick = () => {
    const elapsed = performance.now() - t0
    // Ease toward 90% as elapsed approaches 3×expected, never quite reaching 100.
    const pct = Math.min(90, 90 * (elapsed / (expectedMs * 1.5 + elapsed)))
    fill.style.width = pct.toFixed(1) + '%'
    labelEl.textContent = `${label}… ${Math.round(elapsed)}ms`
    raf = requestAnimationFrame(tick)
  }
  tick()
  return {
    node: pill,
    finish () { cancelAnimationFrame(raf); fill.style.width = '100%'; pill.classList.add('done') },
    detach () { cancelAnimationFrame(raf); pill.remove() }
  }
}

async function copyToClipboard (str) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(str)
    else {
      const ta = document.createElement('textarea')
      ta.value = str; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); ta.remove()
    }
    toast('copied')
  } catch { toast('copy failed') }
}

// ----- router -----

const routes = []
function route (pattern, handler) {
  const parts = pattern.split('/').filter(Boolean)
  routes.push({ parts, handler })
}

async function dispatch () {
  const hash = location.hash.replace(/^#/, '') || '/'
  const [pathRaw] = hash.split('?')
  const parts = pathRaw.split('/').filter(Boolean)
  for (const r of routes) {
    if (r.parts.length !== parts.length) continue
    const params = {}
    let ok = true
    for (let i = 0; i < parts.length; i++) {
      if (r.parts[i].startsWith(':')) params[r.parts[i].slice(1)] = decodeURIComponent(parts[i])
      else if (r.parts[i] !== parts[i]) { ok = false; break }
    }
    if (ok) {
      try { await r.handler(params) } catch (err) {
        console.error(err); render(errorBox(err.message || String(err)))
      }
      return
    }
  }
  render(errorBox('not found'))
}
window.addEventListener('hashchange', dispatch)

// ----- feed views -----

async function renderFeed (sort) {
  render(loading('loading feed…'))
  const posts = await rpc.call('listPosts', { board: DEFAULT_BOARD, sort, limit: 50 })
  const frag = document.createDocumentFragment()
  if (!posts.length) {
    frag.appendChild(h('div', { class: 'empty' },
      'nothing on the front page yet. ',
      h('a', { href: '#/submit' }, 'submit something'),
      ' to get things rolling.'
    ))
  } else {
    const feed = h('div', { class: 'feed' })
    posts.forEach((p, i) => feed.appendChild(feedRow(p, i + 1)))
    frag.appendChild(feed)
  }
  render(frag)
}

route('/', () => renderFeed('hot'))
route('/new', () => renderFeed('new'))

function feedRow (p, rank) {
  const host = p.link ? hostOf(p.link) : null
  const titleHref = p.link || `#/t/${p.opId}`
  const titleTarget = p.link ? '_blank' : null
  const up = h('button', { class: 'vote-btn', title: 'upvote' })
  up.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation()
    try {
      await rpc.call('vote', { targetOpId: p.opId, dir: 1 })
      up.classList.add('active')
    } catch (err) { toastError(err.message) }
  })
  const sublineKids = [
    `${p.score || 0} points by ${displayName(p)} · `,
    h('a', { href: `#/t/${p.opId}` }, ago(p.ts)),
    ' · ',
    h('a', { href: `#/t/${p.opId}` }, `${p.commentCount || 0} comments`)
  ]
  if (isMine(p)) {
    sublineKids.push(' · ')
    sublineKids.push(h('a', { href: '#', onclick: (e) => { e.preventDefault(); openEditor(p, 'post') } }, 'edit'))
    sublineKids.push(' · ')
    sublineKids.push(h('a', { href: '#', onclick: (e) => { e.preventDefault(); confirmDelete(p) } }, 'delete'))
  }
  return h('div', { class: 'feed-row' },
    h('span', { class: 'rank' }, `${rank}.`),
    h('span', { class: 'vote-cell' }, up),
    h('div', { class: 'main' },
      h('div', { class: 'title-line' },
        h('a', {
          class: 'title',
          href: titleHref,
          target: titleTarget,
          rel: titleTarget ? 'noopener' : null
        }, p.title || '(no title)'),
        host ? h('span', { class: 'host' }, `(${host})`) : null
      ),
      h('div', { class: 'subline' }, ...sublineKids)
    )
  )
}

// ----- thread view + nested comments -----

route('/t/:opId', async ({ opId }) => {
  render(loading('loading thread…'))
  const post = await rpc.call('getPost', { opId })
  if (!post) return render(errorBox('post not found — author may not be replicated yet.'))
  const flat = await rpc.call('listCommentTree', { rootOpId: opId })

  const frag = document.createDocumentFragment()
  frag.appendChild(renderPost(post))
  frag.appendChild(replyForm(opId, { placeholder: 'add a top-level comment…' }))

  const tree = h('div', { class: 'comment-tree' })
  renderCommentTree(tree, flat, opId)
  frag.appendChild(tree)

  render(frag)
})

function renderPost (post) {
  const host = post.link ? hostOf(post.link) : null
  const sublineKids = [
    `${post.score || 0} points by ${displayName(post)} · `,
    ago(post.ts),
    post.edited ? h('span', {}, ' · edited') : null
  ]
  if (isMine(post)) {
    sublineKids.push(' · ')
    sublineKids.push(h('a', { href: '#', onclick: (e) => { e.preventDefault(); openEditor(post, 'post') } }, 'edit'))
    sublineKids.push(' · ')
    sublineKids.push(h('a', { href: '#', onclick: (e) => { e.preventDefault(); confirmDelete(post) } }, 'delete'))
  }
  return h('article', { class: 'thread-post' },
    h('div', { class: 'title-line' },
      h('a', {
        class: 'title',
        href: post.link || `#/t/${post.opId}`,
        target: post.link ? '_blank' : null,
        rel: post.link ? 'noopener' : null
      }, post.title),
      host ? h('span', { class: 'host' }, `(${host})`) : null
    ),
    h('div', { class: 'subline' }, ...sublineKids),
    post.body ? h('div', { class: 'body-text' }, post.body) : null
  )
}

// Build a nested tree from the flat array (each comment has `parent` = opId hex).
function renderCommentTree (container, flat, rootOpId) {
  if (!flat.length) {
    container.appendChild(h('div', { class: 'empty' }, 'no comments yet.'))
    return
  }
  // parent → children map
  const children = new Map()
  for (const c of flat) {
    const key = c.parent
    if (!children.has(key)) children.set(key, [])
    children.get(key).push(c)
  }
  // sort siblings by ts asc
  for (const arr of children.values()) arr.sort((a, b) => a.ts - b.ts)

  const roots = children.get(rootOpId) || []
  for (const root of roots) container.appendChild(commentSubtree(root, children, 0))
}

function commentSubtree (c, children, depth) {
  const kids = children.get(c.opId) || []
  const node = h('div', { class: 'comment', style: depth > 0 ? `margin-left:${Math.min(depth, 6) * 18}px` : null },
    commentTileBody(c),
    ...kids.map((k) => commentSubtree(k, children, depth + 1))
  )
  return node
}

function commentTileBody (c) {
  const actionKids = [
    h('a', { href: '#', onclick: (e) => { e.preventDefault(); showInlineReply(c) } }, 'reply')
  ]
  if (isMine(c)) {
    actionKids.push(' · ')
    actionKids.push(h('a', { href: '#', onclick: (e) => { e.preventDefault(); openEditor(c, 'comment') } }, 'edit'))
    actionKids.push(' · ')
    actionKids.push(h('a', { href: '#', onclick: (e) => { e.preventDefault(); confirmDelete(c) } }, 'delete'))
  }
  return h('div', {},
    h('div', { class: 'head' },
      h('span', { class: c.authorNick ? '' : 'mono' }, displayName(c)),
      h('span', {}, '·'),
      h('span', {}, ago(c.ts)),
      c.edited ? h('span', {}, '· edited') : null,
      h('span', {}, `(${c.score >= 0 ? '+' : ''}${c.score})`)
    ),
    h('div', { class: 'body', id: `body-${c.opId}` }, c.body),
    h('div', { class: 'actions', id: `actions-${c.opId}` }, ...actionKids)
  )
}

function showInlineReply (parentComment) {
  const existing = document.getElementById(`reply-${parentComment.opId}`)
  if (existing) { existing.remove(); return }
  const form = replyForm(parentComment.opId, { placeholder: `reply to ${displayName(parentComment)}…` })
  form.id = `reply-${parentComment.opId}`
  document.getElementById(`actions-${parentComment.opId}`).after(form)
}

function replyForm (parentOpId, { placeholder = 'reply…' } = {}) {
  const ta = h('textarea', { placeholder })
  const btn = h('button', { class: 'primary' }, 'reply')
  const actions = h('div', { class: 'actions' }, btn)
  btn.addEventListener('click', async () => {
    const body = ta.value.trim()
    if (!body) return toastError('write something first')
    btn.disabled = true
    const pill = powPill(30, 'minting reply pow')
    actions.appendChild(pill.node)
    try {
      await rpc.call('createComment', { parentOpId, body })
      pill.finish()
      await dispatch()
    } catch (err) {
      pill.detach(); btn.disabled = false
      toastError(err.message)
    }
  })
  return h('div', { class: 'reply-form' }, ta, actions)
}

// ----- edit / delete -----

function openEditor (item, kind) {
  const dialog = h('div', { class: 'modal' },
    h('div', { class: 'modal-inner' },
      h('h3', {}, `edit ${kind}`),
      kind === 'post' ? h('input', { id: 'edit-title', value: item.title || '', maxlength: '200' }) : null,
      h('textarea', { id: 'edit-body' }, item.body || ''),
      h('div', { class: 'actions' },
        h('button', {
          class: 'primary',
          onclick: async (e) => {
            const btn = e.currentTarget
            btn.disabled = true; btn.textContent = 'saving…'
            try {
              await rpc.call('editOp', {
                opId: item.opId,
                body: document.getElementById('edit-body').value,
                title: kind === 'post' ? document.getElementById('edit-title').value : null
              })
              dialog.remove()
              await dispatch()
            } catch (err) { toastError(err.message); btn.disabled = false; btn.textContent = 'save' }
          }
        }, 'save'),
        h('button', { class: 'btn-ghost', onclick: () => dialog.remove() }, 'cancel')
      )
    )
  )
  document.body.appendChild(dialog)
}

async function confirmDelete (item) {
  if (!confirm(`delete this ${item.title ? 'post' : 'comment'}? tombstones hide it but cannot remove signed history.`)) return
  try {
    await rpc.call('deleteOp', { opId: item.opId })
    await dispatch()
  } catch (err) { toastError(err.message) }
}

// ----- submit -----

route('/submit', async () => {
  const form = h('div', { class: 'submit-form' },
    h('h2', { style: 'margin-top: 8px;' }, 'submit'),
    h('table', {},
      h('tbody', {},
        row('title', h('input', { id: 'title', maxlength: '200' })),
        row('url', h('input', { id: 'link', placeholder: 'https://…' })),
        row('text', h('textarea', { id: 'body', placeholder: 'optional' }))
      )
    ),
    h('div', { class: 'actions' },
      h('button', {
        class: 'primary',
        onclick: async (e) => {
          const btn = e.currentTarget
          const title = document.getElementById('title').value.trim()
          const body = document.getElementById('body').value.trim()
          const link = document.getElementById('link').value.trim() || null
          if (!title) return toastError('title is required')
          if (!body && !link) return toastError('either text or url is required')
          btn.disabled = true
          const pill = powPill(100, 'minting post pow')
          btn.after(pill.node)
          try {
            const { opId } = await rpc.call('createPost', { title, body, link })
            pill.finish()
            location.hash = `#/t/${opId}`
          } catch (err) {
            pill.detach(); btn.disabled = false
            toastError(err.message)
          }
        }
      }, 'submit')
    ),
    h('div', { class: 'subline', style: 'margin-top: 12px' },
      'leave url blank to post text. leave text blank to post a link.'
    )
  )
  render(form)
})

function row (label, ctl) {
  return h('tr', {},
    h('td', { class: 'label' }, label),
    h('td', {}, ctl)
  )
}

// ----- /me: profile + identity backup -----

route('/me', async () => {
  render(loading('loading…'))
  const profile = me ? await rpc.call('getProfile', { pubkey: me.pubkey }).catch(() => null) : null
  const keyRes = await rpc.call('exportPrimaryKey').catch(() => null)

  const nickInput = h('input', { id: 'nick', value: profile?.nick || '', maxlength: '40', placeholder: 'pick a nickname' })
  const bioInput = h('textarea', { id: 'bio', placeholder: 'optional bio' }, profile?.bio || '')
  const keyField = h('span', { class: 'mono key-field' }, keyRes?.hex || '(unavailable)')
  const keyReveal = h('button', { class: 'btn-ghost' }, 'reveal key')
  let revealed = false
  keyField.classList.add('blurred')
  keyReveal.addEventListener('click', () => {
    revealed = !revealed
    keyField.classList.toggle('blurred', !revealed)
    keyReveal.textContent = revealed ? 'hide key' : 'reveal key'
  })

  const frag = document.createDocumentFragment()
  frag.appendChild(h('div', { class: 'submit-form' },
    h('h2', { style: 'margin-top: 8px' }, 'identity'),
    h('div', { class: 'subline', style: 'margin-bottom:10px' },
      'pubkey: ', h('span', { class: 'me' }, me.pubkey)
    ),
    h('table', {}, h('tbody', {}, row('nick', nickInput), row('bio', bioInput))),
    h('div', { class: 'actions' },
      h('button', {
        class: 'primary',
        onclick: async (e) => {
          const btn = e.currentTarget
          btn.disabled = true; btn.textContent = 'saving…'
          try {
            await rpc.call('setProfile', { nick: nickInput.value.trim(), bio: bioInput.value.trim() })
            btn.textContent = 'saved'
            toast('profile saved')
            setTimeout(() => { btn.disabled = false; btn.textContent = 'save' }, 700)
          } catch (err) { toastError(err.message); btn.disabled = false; btn.textContent = 'save' }
        }
      }, 'save')
    ),
    h('hr', { style: 'margin: 20px 0; border: 0; border-top: 1px solid var(--border);' }),
    h('h3', {}, 'backup key'),
    h('div', { class: 'subline' },
      'this 64-character hex string is the secret that controls your identity. ',
      h('b', {}, 'save it somewhere safe'),
      '. anyone with this key can post as you. if you lose it you cannot recover the account.'
    ),
    h('div', { style: 'margin-top: 8px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap;' },
      keyField,
      keyReveal,
      h('button', {
        class: 'btn-ghost',
        onclick: () => keyRes?.hex && copyToClipboard(keyRes.hex)
      }, 'copy')
    )
  ))
  render(frag)
})

// ----- /settings (diagnostics; read-only for now) -----

route('/settings', async () => {
  render(loading('gathering stats…'))
  const stats = await rpc.call('getStats').catch((e) => ({ error: e.message }))
  const frag = h('div', { class: 'submit-form' },
    h('h2', { style: 'margin-top: 8px' }, 'settings'),
    stats.error
      ? errorBox(stats.error)
      : h('table', { class: 'kv' }, h('tbody', {},
          kv('transport', rpc.kind),
          kv('storage', stats.storage || '(disk)'),
          kv('swarm', stats.swarm),
          kv('peers', stats.peerCount),
          kv('tracked users', stats.trackedUsers),
          kv('known boards', stats.boards),
          kv('your core length', stats.length),
          kv('pow (post / comment / board)', `${stats.policy.minPowBits.post} / ${stats.policy.minPowBits.comment} / ${stats.policy.minPowBits.board_create} bits`),
          kv('rate limits / hour', `posts ${stats.policy.posts.perHour}, comments ${stats.policy.comments.perHour}, votes ${stats.policy.votes.perHour}`),
          kv('enforce pow', String(stats.policy.enforcePow)),
          kv('enforce rate limit', String(stats.policy.enforceRateLimit))
        )),
    h('div', { class: 'subline', style: 'margin-top: 16px' },
      'these values are baked into the indexer policy. ',
      'write-through settings (overrides, relay endpoints) land in v0.2.'
    )
  )
  render(frag)
})

function kv (k, v) {
  return h('tr', {},
    h('td', { class: 'label' }, k),
    h('td', { class: 'mono' }, String(v))
  )
}

// ----- onboarding (first-launch) -----

route('/welcome', async () => {
  const nickInput = h('input', { id: 'nick', maxlength: '40', placeholder: 'pick a nickname (optional)' })
  const frag = h('div', { class: 'submit-form' },
    h('h1', { style: 'margin-top: 8px' }, 'welcome to p2pbuilders'),
    h('p', { class: 'subline' },
      'this is a ', h('b', {}, 'permissionless, peer-to-peer'),
      ' hacker news. no servers. no accounts to register. your identity is a keypair on this device.'
    ),
    h('p', { class: 'subline' },
      'your pubkey: ', h('span', { class: 'mono' }, me.pubkey)
    ),
    h('h3', {}, 'pick a nickname'),
    h('div', {}, nickInput),
    h('h3', { style: 'margin-top: 20px' }, 'one thing before you start'),
    h('p', { class: 'subline' },
      'your identity is stored as a file on this device only. if you lose it you lose the account. ',
      h('a', { href: '#/me' }, 'back it up from /me'),
      ' when you have a moment.'
    ),
    h('div', { class: 'actions' },
      h('button', {
        class: 'primary',
        onclick: async (e) => {
          const btn = e.currentTarget
          btn.disabled = true; btn.textContent = 'starting…'
          try {
            const nick = nickInput.value.trim()
            if (nick) await rpc.call('setProfile', { nick })
            localStorage.setItem(ONBOARD_FLAG, '1')
            location.hash = '#/'
          } catch (err) { toastError(err.message); btn.disabled = false; btn.textContent = 'get started' }
        }
      }, 'get started')
    )
  )
  render(frag)
})

// ----- boot -----

rpc.onStatus((s) => { document.getElementById('status').textContent = `${rpc.kind}: ${s}` })

;(async () => {
  try {
    me = await rpc.call('me')
    document.getElementById('me').textContent = me ? `id: ${shortHex(me.pubkey, 12)}…` : ''
    // First-launch redirect
    if (!localStorage.getItem(ONBOARD_FLAG) && location.hash.replace(/^#/, '') !== '/welcome') {
      const profile = await rpc.call('getProfile', { pubkey: me.pubkey }).catch(() => null)
      if (!profile?.nick) {
        location.hash = '#/welcome'
        return // dispatch is triggered by hashchange
      }
      localStorage.setItem(ONBOARD_FLAG, '1')
    }
    dispatch()
  } catch (err) {
    render(errorBox(err.message || String(err)))
  }
})()
