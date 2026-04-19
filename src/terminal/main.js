/** @typedef {import('pear-interface')} */ /* global Pear, Bare */
'use strict'

// p2pbuilders terminal app — HN-shaped feed driven by our Bare backend.
// Runs as a Pear terminal application:
//
//   pear run pear://<key>
//
// No GUI, no webview. Same backend (ops, PoW, indexer, swarm, antispam,
// edit/delete, profiles) as the desktop/iOS paths.

// Resolve process via direct conditional (not via subpath imports — Pear's
// bundled Bare may not honor package.json "imports" yet).
const process = (typeof Bare !== 'undefined') ? require('bare-process') : global.process

console.log('p2pbuilders terminal starting…')

// ---- ADMIN -----------------------------------------------------------------
// The single identity allowed to pin posts and delete other users' posts.
// To set this up:
//   1. run the app once (`pear run pear://<key>`)
//   2. at the prompt type `me` — copy the 64-char hex pubkey
//   3. paste it below, re-stage (`pear stage --no-ask dev .`), redistribute
const ADMIN_PUBKEY = '16752aeb998f33904cfa0165526d7f217590e85096a964a07bd29c347edbe86d'

// ---- PINNED POSTS ----------------------------------------------------------
// opIds listed here render at the top of the feed with a 📌 label, above
// the sorted hot/new/top results. Edit this list, re-stage, restart.
// To get an opId: submit the post, the PoW-mint line prints the opId.
const PINNED_OPIDS = [
  '16752aeb998f33904cfa0165526d7f217590e85096a964a07bd29c347edbe86d0000000000000001'
]

const { path } = require('../backend/_rt')
const { Node } = require('../backend/node')
const { Indexer } = require('../backend/indexer')
const { createRPC } = require('../backend/rpc')
const b4a = require('b4a')

// ---- ANSI helpers -----------------------------------------------------------

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  orange: '\x1b[38;5;208m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  clear: '\x1b[2J\x1b[H'
}

const short = (s, n = 8) => (s ? s.slice(0, n) : '')
const fmtAgo = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 45) return `${s}s`
  if (s < 60 * 45) return `${Math.floor(s / 60)}m`
  if (s < 60 * 60 * 22) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// ---- Relay seeding ---------------------------------------------------------
// Asks the public HiveRelay network to pin our own user core and every
// peer we track. Fire-and-forget; errors only go to the background log
// so the foreground UI stays clean.

async function startRelaySeeder ({ node, storage }) {
  // p2p-hiverelay is an ESM module; we dynamic-import so the CommonJS
  // terminal entry can still load it cleanly.
  const { HiveRelayClient } = await import('p2p-hiverelay/client')
  const seederStorage = path.join(storage, '..', 'p2pbuilders-relay-client')
  const client = new HiveRelayClient(seederStorage)
  await client.start()

  const seeded = new Set()
  async function tryseed (pubkey) {
    const hex = b4a.toString(pubkey, 'hex')
    if (seeded.has(hex)) return
    seeded.add(hex)
    try {
      const acc = await client.seed(pubkey, { replicas: 3, timeout: 20000 })
      if (acc.length) {
        // quiet by default — visible through `relays` command below
      }
    } catch {
      seeded.delete(hex) // allow retry
    }
  }

  // Seed our own core now, and every pubkey we track as they come in.
  await tryseed(node.pubkey)
  node.on('track', (pubkey) => { tryseed(pubkey).catch(() => {}) })
  // Also re-scan periodically in case we missed a track event
  setInterval(() => {
    tryseed(node.pubkey).catch(() => {})
    for (const core of node._tracked.values()) {
      tryseed(core.key).catch(() => {})
    }
  }, 5 * 60 * 1000).unref?.()

  // Expose the client so a `relays` command can print status.
  return client
}

// ---- Boot -------------------------------------------------------------------

async function main () {
  const storage = (typeof Pear !== 'undefined' && Pear.config?.storage)
    ? path.join(Pear.config.storage, 'p2pbuilders')
    : path.join(require('../backend/_rt').os.tmpdir(), `p2pbuilders-term-${Date.now()}`)

  process.stdout.write(`${ANSI.orange}p2pbuilders${ANSI.reset} ${ANSI.dim}booting at ${storage}${ANSI.reset}\n`)

  console.log('[boot] opening node…')
  const node = await Node.openDisk(storage, { swarm: {} })
  console.log('[boot] node ready, pubkey prefix:', b4a.toString(node.pubkey, 'hex').slice(0, 16))
  console.log('[boot] opening indexer…')
  const indexer = new Indexer(node, {
    admin: ADMIN_PUBKEY ? b4a.from(ADMIN_PUBKEY, 'hex') : null
  })
  await indexer.ready()
  console.log('[boot] indexer ready')
  const rpc = createRPC({ node, indexer })
  console.log('[boot] rpc wired')

  // Hiverelay persistence — seed our own core + every peer we track onto
  // the public relay network so posts survive when their author goes offline.
  // Runs in the background; any failure is logged but non-fatal.
  let relayClient = null
  startRelaySeeder({ node, storage }).then(c => { relayClient = c }).catch(err => {
    console.log(`${ANSI.dim}[relay] seeding disabled: ${err.message}${ANSI.reset}`)
  })

  // Auto-join the front board so we discover peers
  try { await node.joinBoard('front') } catch {}

  const myPubkey = b4a.toString(node.pubkey, 'hex')
  const amAdmin = !!ADMIN_PUBKEY && myPubkey.toLowerCase() === ADMIN_PUBKEY.toLowerCase()

  // First-launch: if no profile nickname, prompt once
  const profile = await indexer.getProfile(node.pubkey)
  let nick = profile?.nick || null

  process.stdout.write(`${ANSI.dim}your id: ${myPubkey}${amAdmin ? ' ' + ANSI.orange + '(admin)' + ANSI.reset : ''}${ANSI.reset}\n\n`)

  // Current view state
  const state = {
    sort: 'hot',       // 'hot' | 'new' | 'top'
    posts: [],         // raw enriched posts from the RPC
    _display: [],      // what's actually on screen: pinned + rest
    threadId: null,    // opId hex when viewing a thread
    threadPost: null,
    threadComments: []
  }

  // ---- rendering ----
  function header () {
    const peers = node.swarm ? node.swarm.peerCount : 0
    const tracked = node._tracked ? node._tracked.size : 0
    process.stdout.write(
      `${ANSI.orange}${ANSI.bold}p2pbuilders${ANSI.reset} ` +
      `${ANSI.dim}· ${state.sort} · ${peers} peers · tracking ${tracked} · ${nick || short(myPubkey, 8)}${ANSI.reset}\n` +
      `${ANSI.gray}${'─'.repeat(64)}${ANSI.reset}\n`
    )
  }

  function renderPostLine (p, idx, pinned = false) {
    const num = String(idx).padStart(3)
    const score = (p.score >= 0 ? '+' : '') + p.score
    const author = p.authorNick || short(p.author, 8)
    const pin = pinned ? ` ${ANSI.orange}📌${ANSI.reset}` : ''
    const meta = `${ANSI.dim}${score} pts · ${p.commentCount || 0} cm · ${fmtAgo(p.ts)} · ${author}${ANSI.reset}`
    const link = p.link ? ` ${ANSI.cyan}${p.link}${ANSI.reset}` : ''
    process.stdout.write(`${ANSI.gray}${num}.${ANSI.reset}${pin} ${ANSI.bold}${p.title || '(no title)'}${ANSI.reset}${link}\n      ${meta}\n`)
  }

  function renderFeed () {
    process.stdout.write(ANSI.clear)
    header()

    // Split pinned from the rest. Keep declared order within pinned; keep sort
    // order (hot/new/top) within non-pinned.
    const pinnedSet = new Set(PINNED_OPIDS.map((s) => s.toLowerCase()))
    const pinned = []
    const rest = []
    for (const p of state.posts) {
      if (pinnedSet.has(p.opId.toLowerCase())) pinned.push(p)
      else rest.push(p)
    }
    // Also preserve the order declared in PINNED_OPIDS.
    pinned.sort((a, b) => PINNED_OPIDS.indexOf(a.opId) - PINNED_OPIDS.indexOf(b.opId))

    // Display indices are continuous across sections so `open <n>` still works.
    state._display = [...pinned, ...rest]

    if (!state._display.length) {
      process.stdout.write(`${ANSI.dim}  no posts yet. try: submit "hello"${ANSI.reset}\n`)
    } else {
      if (pinned.length) {
        process.stdout.write(`${ANSI.orange}${ANSI.dim}─── pinned ───${ANSI.reset}\n`)
        pinned.forEach((p, i) => renderPostLine(p, i + 1, true))
        if (rest.length) process.stdout.write(`${ANSI.gray}${ANSI.dim}─── ${state.sort} ───${ANSI.reset}\n`)
      }
      rest.forEach((p, i) => renderPostLine(p, pinned.length + i + 1, false))
    }

    process.stdout.write(`\n${ANSI.dim}commands: submit | open <n> | up/down <n> | delete <n> | sort <hot|new|top> | refresh | help | quit${ANSI.reset}\n`)
  }

  function renderThread () {
    process.stdout.write(ANSI.clear)
    header()
    const p = state.threadPost
    if (!p) { process.stdout.write(`${ANSI.red}thread gone${ANSI.reset}\n`); return }
    const score = (p.score >= 0 ? '+' : '') + p.score
    const author = p.authorNick || short(p.author, 8)
    process.stdout.write(`${ANSI.bold}${p.title || '(no title)'}${ANSI.reset}\n`)
    if (p.link) process.stdout.write(`${ANSI.cyan}${p.link}${ANSI.reset}\n`)
    process.stdout.write(`${ANSI.dim}${score} pts · ${fmtAgo(p.ts)} · ${author}${ANSI.reset}\n\n`)
    if (p.body) process.stdout.write(p.body + '\n\n')
    process.stdout.write(`${ANSI.gray}── ${state.threadComments.length} comment(s) ──${ANSI.reset}\n`)
    state.threadComments.forEach((c, i) => {
      const a = c.authorNick || short(c.author, 8)
      process.stdout.write(`\n${ANSI.gray}[${i + 1}]${ANSI.reset} ${a} ${ANSI.dim}· ${fmtAgo(c.ts)} · ${c.score >= 0 ? '+' : ''}${c.score}${ANSI.reset}\n`)
      process.stdout.write(c.body + '\n')
    })
    process.stdout.write(`\n${ANSI.dim}commands: reply <body> | up | down | back | refresh | help | quit${ANSI.reset}\n`)
  }

  async function refreshFeed () {
    state.posts = await rpc.dispatch('listPosts', { board: 'front', sort: state.sort, limit: 50 })
    renderFeed()
  }

  async function refreshThread () {
    const p = await rpc.dispatch('getPost', { opId: state.threadId })
    if (!p) { state.threadId = null; await refreshFeed(); return }
    state.threadPost = p
    state.threadComments = await rpc.dispatch('listCommentTree', { rootOpId: state.threadId })
    // flatten and sort by ts asc for simple rendering
    state.threadComments.sort((a, b) => a.ts - b.ts)
    renderThread()
  }

  // Auto-redraw when new data arrives from peers
  let redrawTimer = null
  const scheduleRedraw = () => {
    if (redrawTimer) return
    redrawTimer = setTimeout(async () => {
      redrawTimer = null
      if (state.threadId) await refreshThread()
      else await refreshFeed()
    }, 500)
  }
  node.on('track', scheduleRedraw)

  // ---- REPL (stdin line buffer, portable between Bare and Node) ----
  const prompt = () => { process.stdout.write(`${ANSI.orange}›${ANSI.reset} `) }
  function printLine (s) { process.stdout.write(s + '\n'); prompt() }

  let stdinBuf = ''
  if (process.stdin.setEncoding) process.stdin.setEncoding('utf8')
  if (process.stdin.ref) process.stdin.ref()          // keep event loop alive
  if (process.stdin.resume) process.stdin.resume()   // start reading
  process.stdin.on('data', (chunk) => {
    stdinBuf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let nl
    while ((nl = stdinBuf.indexOf('\n')) >= 0) {
      const line = stdinBuf.slice(0, nl).replace(/\r$/, '')
      stdinBuf = stdinBuf.slice(nl + 1)
      handle(line)
    }
  })
  const shutdown = async () => {
    process.stdout.write('\n' + ANSI.dim + 'goodbye.' + ANSI.reset + '\n')
    try { await indexer.close() } catch {}
    try { await node.close() } catch {}
    if (typeof Pear !== 'undefined' && Pear.exit) Pear.exit(0)
    else process.exit(0)
  }
  process.stdin.on('end', shutdown)
  if (typeof Pear !== 'undefined' && Pear.teardown) Pear.teardown(shutdown)

  function parseCmd (line) {
    const s = line.trim()
    if (!s) return null
    // Primitive parse: first word + rest
    const i = s.indexOf(' ')
    if (i < 0) return { cmd: s.toLowerCase(), rest: '' }
    return { cmd: s.slice(0, i).toLowerCase(), rest: s.slice(i + 1).trim() }
  }

  function parseQuoted (s) {
    // "title" rest-as-body
    const m = s.match(/^"([^"]*)"\s*(.*)$/)
    if (m) return { title: m[1], rest: m[2] }
    // fallback: split on first space
    const i = s.indexOf(' ')
    if (i < 0) return { title: s, rest: '' }
    return { title: s.slice(0, i), rest: s.slice(i + 1) }
  }

  const isUrl = (s) => /^https?:\/\//.test(s)

  async function handle (line) {
    const parsed = parseCmd(line)
    if (!parsed) { prompt(); return }
    const { cmd, rest } = parsed
    try {
      switch (cmd) {
        case 'help':
        case '?':
          printLine(`
  ${ANSI.bold}feed commands${ANSI.reset}
    submit "title" <body-or-url>   submit a post
    open <n>                       open thread for post #n
    up <n>   down <n>              vote on post #n
    sort <hot|new|top>             change feed sort
    refresh  r                     reload feed

  ${ANSI.bold}thread commands${ANSI.reset}
    reply <body>                   comment on current thread
    up   down                      vote on the post (in thread)
    back b                         back to feed

  ${ANSI.bold}moderation${ANSI.reset}
    delete <n>                     delete a post (author or admin)
    delete                         delete current thread (in thread)

  ${ANSI.bold}identity + infra${ANSI.reset}
    nick <name>                    set your nickname
    me                             show your pubkey + stats
    relays                         where am i pinned? (or current thread author)
    opid <n>                       copy a post's opId
    quit q                         exit
${amAdmin ? '\n  ' + ANSI.orange + '(admin) ' + ANSI.reset + 'you can delete anyone\'s posts + comments.' : ''}
`)
          break
        case 'q':
        case 'quit':
        case 'exit':
          await shutdown()
          return
        case 'me': {
          const stats = await rpc.dispatch('getStats')
          printLine(`  pubkey: ${stats.pubkey}\n  peers: ${stats.peerCount} · tracked: ${stats.trackedUsers} · boards: ${stats.boards}`)
          break
        }
        case 'nick': {
          const name = rest.trim()
          if (!name) { printLine('usage: nick <name>'); break }
          await rpc.dispatch('setProfile', { nick: name })
          nick = name
          printLine(`${ANSI.green}nickname set: ${name}${ANSI.reset}`)
          break
        }
        case 'sort': {
          const s = rest.trim()
          if (!['hot', 'new', 'top'].includes(s)) { printLine('usage: sort hot|new|top'); break }
          state.sort = s
          await refreshFeed()
          prompt()
          return
        }
        case 'r':
        case 'refresh':
          if (state.threadId) await refreshThread()
          else await refreshFeed()
          prompt()
          return
        case 'submit': {
          const { title, rest: body } = parseQuoted(rest)
          if (!title) { printLine('usage: submit "title" <body-or-url>'); break }
          const link = isUrl(body.trim()) ? body.trim() : null
          const text = link ? '' : body
          process.stdout.write(`${ANSI.dim}minting pow…${ANSI.reset}`)
          const t0 = Date.now()
          const { opId } = await rpc.dispatch('createPost', { title, body: text, link })
          await refreshFeed()
          // Print the opId AFTER the feed clear so it stays visible.
          process.stdout.write(`${ANSI.green}posted in ${Date.now() - t0}ms${ANSI.reset}\n`)
          process.stdout.write(`${ANSI.dim}opId (copy for pinning): ${ANSI.reset}${opId}\n`)
          prompt()
          return
        }
        case 'open': {
          const n = parseInt(rest, 10)
          if (!n || !state._display[n - 1]) { printLine(`no post #${n}`); break }
          state.threadId = state._display[n - 1].opId
          await refreshThread()
          prompt()
          return
        }
        case 'back':
        case 'b':
          state.threadId = null
          state.threadPost = null
          state.threadComments = []
          await refreshFeed()
          prompt()
          return
        case 'up':
        case 'down': {
          const dir = cmd === 'up' ? 1 : -1
          let targetOpId
          if (state.threadId) targetOpId = state.threadId
          else {
            const n = parseInt(rest, 10)
            if (!n || !state._display[n - 1]) { printLine(`no post #${n}`); break }
            targetOpId = state._display[n - 1].opId
          }
          await rpc.dispatch('vote', { targetOpId, dir })
          printLine(`${ANSI.green}voted ${cmd}${ANSI.reset}`)
          if (state.threadId) await refreshThread()
          else await refreshFeed()
          return
        }
        case 'relays': {
          if (!relayClient) { printLine(`${ANSI.dim}relay client not connected yet…${ANSI.reset}`); break }
          const targetHex = state.threadPost?.author || b4a.toString(node.pubkey, 'hex')
          const keyBuf = b4a.from(targetHex, 'hex')
          process.stdout.write(`${ANSI.dim}querying…${ANSI.reset}`)
          try {
            const acc = await relayClient.seed(keyBuf, { replicas: 5, timeout: 15000 })
            process.stdout.write('\r                   \r')
            printLine(`${ANSI.dim}pinned on ${acc.length} relay(s) for ${b4a.toString(keyBuf, 'hex').slice(0, 12)}…:${ANSI.reset}`)
            for (const a of acc) {
              const pk = b4a.toString(a.relayPubkey, 'hex').slice(0, 12)
              printLine(`  ${a.region.padEnd(5)} ${pk}…`)
            }
          } catch (err) {
            printLine(`${ANSI.red}relay query failed: ${err.message}${ANSI.reset}`)
          }
          return
        }
        case 'opid': {
          const n = parseInt(rest, 10)
          const post = state._display[n - 1]
          if (!post) { printLine(`no post #${n}`); break }
          printLine(`${ANSI.dim}opId #${n}:${ANSI.reset} ${post.opId}`)
          break
        }
        case 'delete':
        case 'rm': {
          let target, author
          if (state.threadId) {
            target = state.threadId
            author = state.threadPost?.author
          } else {
            const n = parseInt(rest, 10)
            const post = state._display[n - 1]
            if (!post) { printLine(`no post #${n}`); break }
            target = post.opId
            author = post.author
          }
          const isAuthor = author && author.toLowerCase() === myPubkey.toLowerCase()
          if (!isAuthor && !amAdmin) { printLine(`${ANSI.red}only the author (or admin) can delete${ANSI.reset}`); break }
          await rpc.dispatch('deleteOp', { opId: target })
          printLine(`${ANSI.green}tombstoned (hidden — signed history remains)${ANSI.reset}`)
          if (state.threadId) { state.threadId = null; state.threadPost = null }
          await refreshFeed()
          prompt()
          return
        }
        case 'reply': {
          if (!state.threadId) { printLine('no thread open. use: open <n>'); break }
          if (!rest.trim()) { printLine('usage: reply <body>'); break }
          process.stdout.write(`${ANSI.dim}minting pow…${ANSI.reset}`)
          const t0 = Date.now()
          await rpc.dispatch('createComment', { parentOpId: state.threadId, body: rest })
          process.stdout.write(`\r${ANSI.green}replied in ${Date.now() - t0}ms${ANSI.reset}       \n`)
          await refreshThread()
          prompt()
          return
        }
        default:
          printLine(`unknown: ${cmd}. try 'help'`)
      }
    } catch (err) {
      printLine(`${ANSI.red}error: ${err.message}${ANSI.reset}`)
    }
    prompt()
  }

  await refreshFeed()
  prompt()
}

main().catch((err) => {
  console.error('[boot] fatal error:', (err && err.stack) || String(err))
  if (typeof Bare !== 'undefined' && Bare.exit) Bare.exit(1)
  else process.exit(1)
})
