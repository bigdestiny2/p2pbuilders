// learn-content.js — the p2pbuilders Learn hub. One data module, two surfaces:
// the web app renders it at #/learn, the terminal app prints it via `learn`.
//
// Everything here is plain markdown (rendered by markdown.js in the browser and
// by a tiny ANSI formatter in the TUI). Keep bodies self-contained: no images,
// only http(s)://, hyper://, pear:// and #/ links.
//
// Adding a lesson: append to LESSONS with a unique `id`, an existing `section`,
// and a markdown `body`. Run `node web/test/learn.mjs` to validate.
// The Field Manual section is generated (see fieldmanual-content.js).

import { FIELD_MANUAL_LESSONS } from './fieldmanual-content.js'

export const SECTIONS = [
  {
    id: 'fieldmanual',
    title: "The P2P Engineer's Field Manual",
    blurb: 'Our 7-day crash course — DHTs and Kademlia to hand-written binary protocols, NAT traversal, Noise handshakes and profiler flame graphs. Every day ends in a runnable lab.',
    href: 'fieldmanual.html',
    hrefLabel: 'read the designed edition ↗'
  },
  {
    id: 'handbook',
    title: 'P2P Foundations',
    blurb: 'The ideas underneath everything we build — keys, logs, discovery, availability, trust. Start here if you are new to P2P.'
  },
  {
    id: 'holepunch',
    title: 'Holepunch walkthroughs',
    blurb: 'Hands-on tours of the building blocks: Pear, Bare, Hypercore, Hyperbee, Hyperdrive, Hyperswarm, Corestore, Autobase.'
  },
  {
    id: 'rooms',
    title: 'Storyteller & Pear Baby Rooms',
    blurb: 'Our beginner lesson tracks. Baby Rooms takes you from zero to your first live room; Storyteller builds a real app one chapter at a time.'
  },
  {
    id: 'eco',
    title: 'Lessons from our ecosystem',
    blurb: 'Hard-won lessons from running p2pbuilders, peerit and HiveRelay in the wild. Scars included.'
  },
  {
    id: 'builds',
    title: 'Build articles',
    blurb: 'Write-ups of things we actually shipped: the terminal HN, the browser port, the relay fleet.'
  },
  {
    id: 'patterns',
    title: 'Patterns for P2P apps',
    blurb: 'A working catalog of shapes that keep showing up in peer-to-peer apps — steal these.'
  }
]

export const LESSONS = [

  // ── The P2P Engineer's Field Manual (generated module) ────────────────────
  ...FIELD_MANUAL_LESSONS,

  // ── P2P Foundations ───────────────────────────────────────────────────────

  {
    id: 'handbook-intro',
    section: 'handbook',
    title: 'Why peer-to-peer',
    minutes: 5,
    summary: 'What breaks when everything lives on a server, and what we get back when it does not.',
    body: `
# Why peer-to-peer

Most of the internet you use is a client asking a server for permission. The
server owns the data, the identity, the uptime, and the off switch. That model
is convenient — and fragile. Companies die, terms change, accounts get locked,
databases leak.

Peer-to-peer flips the ownership:

- **Your identity is a keypair you generate.** Nobody issues it, nobody can
  revoke it.
- **Your data is a log you sign.** Anyone can hold a copy; nobody can forge an
  entry.
- **The network is the users.** Peers find each other directly and replicate
  each other's data. There is no origin server to take down.

The tradeoffs are real, and this track does not hide them: availability is
your problem now (see [Staying online without servers](#/learn/handbook-availability)),
moderation has no root admin (see [Trust without a boss](#/learn/handbook-trust)),
and "delete" means less than people expect.

But the payoff is software that works *without asking permission* — the whole
reason p2pbuilders exists. Everything on this board is a 32-byte public key
talking to other 32-byte public keys.

**Reading order:** this chapter, then
[Identity is a keypair](#/learn/handbook-identity) →
[Everything is a signed log](#/learn/handbook-logs) →
[How peers find each other](#/learn/handbook-discovery) →
[Staying online without servers](#/learn/handbook-availability) →
[Trust without a boss](#/learn/handbook-trust).
When you want to touch code, jump to the
[Holepunch walkthroughs](#/learn) or the [Pear Baby Rooms](#/learn/rooms-baby-1) track.
`
  },

  {
    id: 'handbook-identity',
    section: 'handbook',
    title: 'Identity is a keypair',
    minutes: 6,
    summary: 'No signup, no recovery, no registry — you are your public key. What that buys and what it costs.',
    body: `
# Identity is a keypair

In a P2P system there is no "create account" endpoint. On first launch your app
generates a random secret, derives an Ed25519 keypair from it, and that is you:

- The **public key** is your global identity. You hand it out freely; peers use
  it to verify everything you publish.
- The **secret key** signs your writes. Anyone holding it *is* you.

This is exactly how p2pbuilders works: each user is one Hypercore whose public
key is their identity. Nicknames are just advisory profile records — the key is
the name.

## What this buys you

- **Permissionless entry.** Nobody can stop you from generating a key.
- **Global verifiability.** Any peer can check any record offline — no
  authentication server in the loop.
- **Pseudonymity by default.** A key says nothing about you until you attach
  something to it.

## What it costs you

- **No recovery.** Lose the secret, lose the identity. There is no "forgot
  password". Back up the key material (p2pbuilders stores it mode 0600 on
  disk; the web build keeps it in local storage — export it).
- **No revocation.** A leaked key is a stolen identity. The best you can do is
  publish from a new key and tell people.
- **Sybils are free.** Anyone can mint a million keys. Anti-spam has to come
  from somewhere else — cost (proof-of-work), time (reputation aging), or
  curation (blocklists). See [Trust without a boss](#/learn/handbook-trust).

## Practical rules we follow

1. One key per app, derived from one stored primary secret (Corestore does the
   derivation — see the [Corestore walkthrough](#/learn/hp-corestore)).
2. Treat "the user typed a nickname" as decoration, never as identity.
3. Show short key prefixes in the UI, full keys on demand — people verify by
   comparing prefixes out-of-band.
`
  },

  {
    id: 'handbook-logs',
    section: 'handbook',
    title: 'Everything is a signed log',
    minutes: 7,
    summary: 'Append-only logs are the atom of P2P data. State is a fold over everyone’s logs.',
    body: `
# Everything is a signed log

The core data structure of this whole ecosystem is embarrassingly simple: an
**append-only list of blocks, signed by one author**. That is a Hypercore.

Why append-only?

- **Sync is trivial.** "I have 41 entries, you have 38, here are 3 more."
  Compare lengths, ship the tail. No diffing, no merge conflicts *within* a log.
- **Verification is built in.** Each block is covered by the author's
  signature, so replicas can relay each other's copies without being trusted.
- **History is honest.** You can add, you cannot silently rewrite.

## From logs to app state

A log is not an app. The move that makes it one is the **fold**: every peer
replays every log it follows through a pure reducer into a local view.

\`\`\`
for each op in each followed log (any order):
  if valid(op): view = apply(view, op)
\`\`\`

p2pbuilders' ops are \`post\`, \`comment\`, \`vote\`, \`edit\`, \`tombstone\`,
\`follow\`, \`block\`, \`profile\`… The feed you see is nothing but a fold of
every author log you replicate, indexed into a local database
([Hyperbee](#/learn/hp-hyperbee)).

Two rules make folds sane:

1. **Ops reference, never contain.** A comment points at its parent by id; a
   vote points at its target. The fold stitches the graph together.
2. **The fold must converge.** Whatever order ops arrive in, peers that have
   the same set of ops must compute the same view. Last-write-wins with a
   deterministic tiebreaker covers most records (see
   [Data patterns](#/learn/pattern-data)).

## Delete is a lie (sort of)

You cannot unappend. "Delete" in log-world is a **tombstone** op that tells
conforming indexers to hide the target. The signed history remains in every
replica. Design for it: say "hidden", not "erased", and never put secrets in a
log.
`
  },

  {
    id: 'handbook-discovery',
    section: 'handbook',
    title: 'How peers find each other',
    minutes: 6,
    summary: 'DHTs, topics, and gossip: getting from "I know a hash" to "I have live sockets to strangers".',
    body: `
# How peers find each other

There is no server, so who do you connect to? Discovery happens in layers:

## 1. The DHT

Hyperswarm runs a global **distributed hash table** — millions of nodes, each
holding a slice of a big lookup space. You announce yourself under a 32-byte
**topic**; anyone who looks up that topic learns your address and holepunches a
direct, encrypted connection to you. (NAT traversal is the hard part; the DHT
brokers the punch. That is the [Hyperswarm walkthrough](#/learn/hp-hyperswarm).)

## 2. Topics are rendezvous points

A topic is just a hash both sides can compute:

\`\`\`
topic = blake2b('p2pbuilders:board:v1:front')
\`\`\`

Same string, same hash, same meeting point. Apps derive topics from anything
shared: an app name, a board name, a drive key, an invite code. p2pbuilders
joins one topic per board plus a global roster topic.

## 3. Gossip fills in the graph

The DHT finds you *some* peers; gossip finds you *the rest*. Once connected,
peers exchange what they know — in our case an announce channel that shares
every author pubkey seen on the board. Join with one connection, and within
seconds you are tracking every author's log transitively: C learns about A
from B without ever meeting A on the DHT.

## Rules of thumb

- **Version your topics** (\`:v1:\`) so a breaking protocol change moves to a
  clean namespace instead of confusing old peers.
- **Gossip keys, not content.** Content replicates over verified logs; gossip
  only needs to spread *pointers* (pubkeys, drive keys). Fake pointers cost
  nothing because every log self-verifies.
- **Expect churn.** Peers vanish constantly. Discovery is a continuous
  process, not a boot step.
`
  },

  {
    id: 'handbook-availability',
    section: 'handbook',
    title: 'Staying online without servers',
    minutes: 6,
    summary: 'The laptop-lid problem, and how dumb always-on storage (relays) solves it without recreating servers.',
    body: `
# Staying online without servers

The most common gotcha in P2P: you publish something, close your laptop, and it
is gone. Data lives on peers; if no peer holding it is online, nobody can fetch
it. We call this the **laptop-lid problem**.

## The honest answers

1. **More readers = more replicas.** Anyone who read your post holds a copy and
   can serve it. Popular content stays alive on its own. Unpopular content —
   the long tail — does not.
2. **Always-on peers.** *Some* machine has to be awake. The trick is keeping it
   a dumb peer instead of letting it become a server.

## Relays: dumb storage, not authority

[HiveRelay](https://github.com/bigdestiny2/P2P-Hiverelay) is our answer: a
fleet of always-on nodes that will **pin** (replicate and re-serve) any
Hypercore you ask them to. The crucial design line:

- A relay **cannot forge** anything — logs are author-signed, so a relay is
  just a mirror.
- A relay **does not index, validate or moderate** — it stores bytes. All
  meaning lives at the edges.
- Losing every relay degrades availability, never integrity.

p2pbuilders seeds your log (and every author you track) to the relay fleet on
boot — the \`relays\` command in the TUI shows who is pinning you. Posts
survive with 5+ relays across 3 continents even when every author sleeps.

## Design guidance

- Treat relays as a *cache tier*, not a dependency. The app must work
  peer-to-peer with zero relays reachable.
- Seed **everything the data needs to be reconstructed** — a lesson we learned
  the hard way with Hyperdrives; see
  [Seed the blobs core](#/learn/eco-blobs).
- Re-announce periodically. Pins age out; a live peer re-requesting keeps them
  fresh.
`
  },

  {
    id: 'handbook-trust',
    section: 'handbook',
    title: 'Trust without a boss',
    minutes: 8,
    summary: 'Spam, sybils and moderation when nobody owns the network: cost, time, and chosen curators.',
    body: `
# Trust without a boss

A permissionless network has no admin table. Anyone can mint keys and write.
So how is p2pbuilders not a spam firehose? Layers — each weak alone, useful
together:

## Layer 1: make writing cost something (proof-of-work)

Every post, comment and board-create carries a hashcash stamp: the author must
find a nonce whose hash meets a difficulty target. ~80ms for a post, ~20ms for
a comment — unnoticeable for a human, expensive at spam volume. Peers simply
refuse to index un-worked ops.

The subtlety: **PoW is an indexing policy, not consensus.** Nothing stops a
peer from accepting junk into its own view; the default policy just will not.
More in [PoW and reputation: honest limits](#/learn/eco-antispam).

## Layer 2: make influence take time (reputation)

Votes are weighted by the voter's key:

\`\`\`
rep(key)    = log2(1 + ageDays) * sqrt(1 + receivedUpvotes)
voteWeight  = clamp(rep / 50, 0.02, 1.0)
\`\`\`

A fresh key can vote (0.02 floor — day-one users are not muted) but cannot
move rankings. Influence accrues with *age observed by the network* — not
author-claimed timestamps, which could be backdated.

## Layer 3: rate limits

Indexers drop cores that exceed sane per-key rates (posts/hour,
comments/hour, votes/hour). Replication stays cheap; indexing is the choke
point.

## Layer 4: chosen moderation (blocklists)

Every user has a local blocklist. Anyone can *publish* theirs; anyone else can
*subscribe*, adopting the curator's blocks. A handful of widely-subscribed
curators produces de-facto moderation — but you picked your moderators, and
you can unsubscribe. Nobody owns the board.

## Be honest about the gaps

Cross-voting rings defeat naive reputation (100 aged keys upvoting each other
≈ 35 legit users' weight — we published the math in the spec). PoW slows
spam; it does not stop a motivated attacker. Ship the layers, document the
weaknesses, and keep the human escape hatch: curation.
`
  },

  // ── Holepunch walkthroughs ────────────────────────────────────────────────

  {
    id: 'hp-pear',
    section: 'holepunch',
    title: 'Pear: run, stage, release, seed',
    minutes: 8,
    summary: 'The P2P runtime — running apps from pear:// links and shipping your own without a server.',
    body: `
# Pear: run, stage, release, seed

[Pear](https://docs.pears.com) is Holepunch's runtime for P2P applications:
desktop and terminal apps that load **from a pear:// link** — peer-to-peer,
not from a store or a CDN.

## Run someone's app

\`\`\`
npm i -g pear
pear                      # first run bootstraps the runtime
pear run pear://dqz1e6fwyrz1mxj7eqsmcar3hnegrj491t5hnqjm9mda9tz8dzfy
\`\`\`

That last command is p2pbuilders itself: Pear resolves the key on the DHT,
replicates the app's Hyperdrive from whoever seeds it, and runs it locally.

## Anatomy of a Pear app

A Pear app is a directory with a \`package.json\` carrying a \`pear\` field:

\`\`\`
"pear": {
  "name": "p2pbuilders",
  "type": "terminal",
  "main": "src/terminal/main.js"
}
\`\`\`

\`type: "terminal"\` gives you a TUI on [Bare](#/learn/hp-bare) — no browser,
no Electron. Desktop GUI apps use the same flow with an HTML entry.

## Ship your own

\`\`\`
pear touch                          # mint a pear:// key (once per app)
pear stage --no-ask pear://<key> .  # sync working tree → versioned build
pear release pear://<key> .         # point the bare link at that build
pear run pear://<key>               # anyone, anywhere
\`\`\`

**Staging** publishes your tree as a Hyperdrive under the key. **Release**
marks the version that a bare \`pear run pear://<key>\` resolves to — so you
can stage experimental builds without breaking users.

Two gotchas from our own staging sessions:

- Paths with spaces can break tooling — symlink your checkout to
  \`/tmp/yourapp\` and stage from there.
- Your machine is the only seeder until someone else runs the app — keep the
  process alive, or pin the drive on relays
  ([Staying online](#/learn/handbook-availability)).

Full docs: https://docs.pears.com
`
  },

  {
    id: 'hp-bare',
    section: 'holepunch',
    title: 'Bare: the small JS runtime',
    minutes: 6,
    summary: 'Node-shaped JavaScript without Node — why P2P apps run on Bare, and how to write portable code.',
    body: `
# Bare: the small JS runtime

[Bare](https://github.com/holepunchto/bare) is a minimal JavaScript runtime:
V8 plus a tiny native core, with everything else — fs, tcp, tty, crypto —
shipped as **addon modules** instead of baked in. It is what Pear terminal
apps and mobile embeddings actually run on.

Why it matters for P2P:

- **Small enough to embed.** Bare runs inside iOS/Android apps (bare-kit), so
  the same backend that powers your desktop node runs on a phone.
- **No monolith to wait on.** Modules version independently; the runtime
  stays tiny.

## Node-compatible-ish, by choice

Bare mirrors Node's module shapes (\`bare-fs\` ≈ \`fs\`, \`bare-process\` ≈
\`process\`, …). The trick for code that runs on **both** is conditional
imports in \`package.json\`:

\`\`\`
"imports": {
  "#fs":      { "bare": "bare-fs",      "default": "./shims/node-fs.js" },
  "#process": { "bare": "bare-process", "default": "./shims/node-process.js" }
}
\`\`\`

Then \`require('#fs')\` resolves to the right implementation per runtime.
p2pbuilders isolates every platform touchpoint behind one \`_rt.js\` shim —
that single decision is why the same backend boots under Node, Pear and
bare-kit unmodified.

## Try it

\`\`\`
npm i bare bare-process
./node_modules/bare/bin/bare app.js
\`\`\`

In app code, detect the runtime when you must:

\`\`\`
const process = (typeof Bare !== 'undefined')
  ? require('bare-process')
  : global.process
\`\`\`

**Rule we live by:** never sprinkle runtime checks through app logic. One shim
module owns the differences; everything else imports the shim.
`
  },

  {
    id: 'hp-hypercore',
    section: 'holepunch',
    title: 'Hypercore: the signed append-only log',
    minutes: 8,
    summary: 'The atom of the stack — append, read, replicate, verify. With runnable code.',
    body: `
# Hypercore: the signed append-only log

[Hypercore](https://github.com/holepunchto/hypercore) is the primitive
everything else builds on: an append-only list of binary blocks, signed by a
single writer, replicable by anyone.

\`\`\`
const Hypercore = require('hypercore')

const core = new Hypercore('./storage')       // creates or reopens
await core.ready()

console.log(core.key.toString('hex'))         // public identity of this log
console.log(core.length)                      // blocks so far

await core.append(Buffer.from('hello'))       // only the key holder can do this
const b = await core.get(0)                   // anyone with a replica can read
\`\`\`

The things to internalize:

- **One writer.** The keypair that created the core is the only thing that can
  extend it. Multi-writer is a different layer
  ([Autobase](#/learn/hp-autobase)).
- **Everyone else replicates.** \`core.get(i)\` on a reader fetches the block
  from any connected peer and **verifies it against the author's signature**
  before handing it to you. Mirrors need zero trust.
- **Sparse by default.** Readers download only the blocks they ask for — you
  can index a 10k-entry log while fetching a fraction of it.

## Wiring two peers

Replication runs over any duplex stream; in practice you get streams from
[Hyperswarm](#/learn/hp-hyperswarm):

\`\`\`
swarm.on('connection', (socket) => core.replicate(socket))
core.on('append', () => console.log('log grew to', core.length))
\`\`\`

## How p2pbuilders uses it

Each user = one Hypercore. Every action (post, comment, vote, profile…) is one
encoded op appended to their own core. Nobody ever writes to anyone else's
log — the "shared" board is a fold over many single-writer logs
([Everything is a signed log](#/learn/handbook-logs)).

Start here before Hyperbee/Hyperdrive: both are *just interpretations of a
Hypercore*, and the whole stack makes sense once that clicks.
`
  },

  {
    id: 'hp-hyperbee',
    section: 'holepunch',
    title: 'Hyperbee: a database on a log',
    minutes: 7,
    summary: 'An ordered key/value store encoded as Hypercore blocks — sorted scans, prefixes as tables.',
    body: `
# Hyperbee: a database on a log

[Hyperbee](https://github.com/holepunchto/hyperbee) is a B-tree encoded as
Hypercore blocks: each \`put\` appends a node describing the tree change. The
result is a **sorted key/value database with the replication properties of a
log** — single writer, many verified readers, sparse download.

\`\`\`
const Hypercore = require('hypercore')
const Hyperbee = require('hyperbee')

const bee = new Hyperbee(new Hypercore('./db'), {
  keyEncoding: 'utf-8',
  valueEncoding: 'json'
})

await bee.put('profile!alice', { nick: 'alice' })
const node = await bee.get('profile!alice')     // { key, value } or null
await bee.del('profile!alice')
\`\`\`

## The idiom: key ranges are your tables

There are no tables or secondary indexes — you *design* your keyspace so
ordered scans answer your queries:

\`\`\`
post!front!new!<invertedTs>!<id>   → post ref
comment!<postId>!<ts>!<id>         → comment ref
vote!<targetId>!<voter>            → direction
\`\`\`

Then a prefix scan is a query:

\`\`\`
for await (const { key, value } of bee.createReadStream({
  gt: 'comment!abc!', lt: 'comment!abc!~'
})) { /* every comment on post abc, in time order */ }
\`\`\`

Trick worth stealing: **inverted timestamps** (\`999…9 - ms\`) make ascending
scans return newest-first, so "latest 50 posts" is a limited range read.

## Two ways to use it

1. **Replicated bee** — the author writes, readers replicate and query
   sparsely (a reader checking one key downloads ~log(n) blocks).
2. **Local index** — a private bee as your app's query layer. This is
   p2pbuilders: the indexer folds every followed Hypercore into a local
   Hyperbee (\`post!…\`, \`vote!…\`, \`rep!…\`), and the UI only ever queries
   the bee. Rebuildable state, ordered queries, no SQL dependency.
`
  },

  {
    id: 'hp-hyperdrive',
    section: 'holepunch',
    title: 'Hyperdrive: a filesystem on two cores',
    minutes: 7,
    summary: 'P2P file trees — how drives really store bytes, and the operational trap that follows.',
    body: `
# Hyperdrive: a filesystem on two cores

[Hyperdrive](https://github.com/holepunchto/hyperdrive) gives you a
versioned file tree you can replicate like everything else. It is how Pear
apps ship and how P2P sites (this app's web build included) are hosted.

\`\`\`
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')

const drive = new Hyperdrive(new Corestore('./storage'))
await drive.ready()

await drive.put('/index.html', Buffer.from('<h1>hi</h1>'))
const buf = await drive.get('/index.html')
for await (const entry of drive.list('/')) console.log(entry.key)

console.log(drive.key.toString('hex'))   // share this — hyper://<key>/
\`\`\`

A reader opens the same drive by key, replicates over swarm connections, and
reads files sparsely — a 2GB drive costs a reader only the files they touch.
Drives are versioned; \`drive.checkout(n)\` gives you an old snapshot.

## The part everyone misses

**A Hyperdrive is two Hypercores.**

1. A **metadata core** — a [Hyperbee](#/learn/hp-hyperbee) mapping paths to
   entries.
2. A **content (blobs) core** — the actual file bytes.

\`drive.key\` is the *metadata* key. Anything that pins "the drive by key" —
a relay, a mirror script — may replicate metadata and never fetch the bytes.
The drive looks alive (listings work!) but every read fails once the
publisher goes offline.

\`\`\`
const blobs = await drive.getBlobs()
console.log(blobs.core.key.toString('hex'))   // pin THIS too
\`\`\`

We shipped that bug and wrote it up:
[Seed the blobs core, not just the metadata](#/learn/eco-blobs). If you host
anything on drives, read it.
`
  },

  {
    id: 'hp-hyperswarm',
    section: 'holepunch',
    title: 'Hyperswarm: find peers by topic',
    minutes: 7,
    summary: 'The DHT + holepunching layer — join a 32-byte topic, get encrypted sockets to strangers.',
    body: `
# Hyperswarm: find peers by topic

[Hyperswarm](https://github.com/holepunchto/hyperswarm) answers "who else
cares about this hash?" and hands you **encrypted, holepunched connections**
to each of them. It is the networking layer for the entire stack.

\`\`\`
const Hyperswarm = require('hyperswarm')
const crypto = require('hypercore-crypto')

const swarm = new Hyperswarm()

// A topic is any 32 bytes both sides can derive.
const topic = crypto.hash(Buffer.from('p2pbuilders:board:v1:front'))

swarm.join(topic, { server: true, client: true })
swarm.on('connection', (socket, info) => {
  // socket is an encrypted duplex stream to a peer on the same topic.
  socket.write('hello')
  socket.on('data', (d) => console.log('peer says', d.toString()))
})
await swarm.flush()    // announced + initial lookups done
\`\`\`

What you get for free:

- **NAT traversal.** Both peers behind home routers still connect directly in
  most cases — the DHT brokers the holepunch.
- **Encryption + peer identity.** Every connection is a Noise channel;
  \`socket.remotePublicKey\` cryptographically identifies the other end.
- **Deduping.** One connection per peer even when you share many topics.

## Usage patterns

- **Core replication:** \`swarm.on('connection', s => store.replicate(s))\` —
  every core in your [Corestore](#/learn/hp-corestore) syncs over every
  socket. Hypercore's protocol multiplexes and only transfers cores both
  sides know.
- **Custom protocols:** speak your own messages over the socket (we run a
  protomux "announce" channel gossiping author pubkeys —
  [How peers find each other](#/learn/handbook-discovery)).
- **Direct dial:** \`swarm.joinPeer(pubkey)\` connects to one specific peer
  without a shared topic.

Expect churn: connections drop, peers reappear with new addresses. Write your
handler so any peer can vanish at any moment and nothing breaks.
`
  },

  {
    id: 'hp-corestore',
    section: 'holepunch',
    title: 'Corestore: many cores, one storage',
    minutes: 5,
    summary: 'Namespaced core management — one primary key, deterministic derived cores, one replication stream.',
    body: `
# Corestore: many cores, one storage

Real apps juggle many Hypercores: yours, every peer's you follow, metadata
and blobs per drive. [Corestore](https://github.com/holepunchto/corestore)
manages them under one storage directory and — the key feature — **derives
your writable cores deterministically from one primary key**.

\`\`\`
const Corestore = require('corestore')
const store = new Corestore('./storage')

// Writable: derived from the store's primary key + a name.
const feed = store.get({ name: 'p2pbuilders/user' })
await feed.ready()   // same name → same keypair, every launch

// Read-only: someone else's core, by public key.
const theirs = store.get(Buffer.from(theirKeyHex, 'hex'))
\`\`\`

Why this matters:

- **One secret to protect.** Back up the primary key and you have backed up
  every identity the app derives. This is p2pbuilders' whole identity story:
  primary key on disk (mode 0600), user core derived as
  \`(primaryKey, 'p2pbuilders/user')\`.
- **Namespaces compose.** \`store.namespace('drafts').get({ name: 'log' })\`
  lets libraries create cores without colliding with yours.
- **Replication is one call.**

\`\`\`
swarm.on('connection', (socket) => store.replicate(socket))
\`\`\`

Every core in the store syncs over that socket — but only cores **both sides
already know the key for**. Replication never leaks keys; discovery of *which*
cores exist is your app's job (gossip, invites, directories).

Habit to build: open cores through the store everywhere — never construct a
raw Hypercore with its own storage path once an app grows past hello-world.
`
  },

  {
    id: 'hp-autobase',
    section: 'holepunch',
    title: 'Autobase: many writers, one view',
    minutes: 8,
    summary: 'How multi-writer works on single-writer logs: input cores, causal ordering, deterministic views.',
    body: `
# Autobase: many writers, one view

Hypercore's superpower — one signed writer — is also its limit: how do five
people edit one thing? [Autobase](https://github.com/holepunchto/autobase)
is Holepunch's answer, and even when you do not use the library, its *shape*
is how you should think about multi-writer.

## The idea

- Every participant writes only to **their own input core** (normal
  single-writer Hypercores — nothing new to trust).
- Autobase interleaves all inputs into one **causally ordered stream** (each
  entry references the latest entries the writer had seen — a vector-clock-ish
  ordering, with deterministic tiebreaks).
- An **apply function** — pure, same on every peer — folds that stream into a
  materialized view (often a [Hyperbee](#/learn/hp-hyperbee)).

\`\`\`
const base = new Autobase(store, bootstrapKey, {
  open:  (store) => store.get('view'),
  apply: async (nodes, view, host) => {
    for (const node of nodes) {
      // node.value is one writer's entry; fold it into the view.
      // host.addWriter(key) is how membership changes happen — in-band.
    }
  }
})
await base.append({ type: 'msg', text: 'hi' })   // writes to YOUR input
\`\`\`

Same inputs ⇒ same order ⇒ same view, on every peer. When a writer's history
arrives late, affected view state is recomputed — so **apply must be
deterministic**: no clocks, no randomness, no network.

## When you need it (and when you don't)

p2pbuilders does *not* use Autobase — a board folds independent per-user logs
where cross-user ordering barely matters (votes commute; comments hang off
ids). We get convergence with a plain reducer.

Reach for Autobase when the state itself is shared and order matters: a
collaborative doc, a shared room roster, a game. That is exactly the
[Storyteller: passing the pen](#/learn/storyteller-2) lesson.

API details move — check https://docs.pears.com/building-blocks/autobase for
current signatures. The mental model above is stable.
`
  },

  // ── Storyteller & Pear Baby Rooms ─────────────────────────────────────────

  {
    id: 'rooms-baby-1',
    section: 'rooms',
    title: 'Pear Baby Rooms 1: your first room',
    minutes: 10,
    summary: 'From zero to two machines chatting P2P: one topic, one swarm, ~40 lines, no server.',
    body: `
# Pear Baby Rooms 1: your first room

Baby Rooms is our from-absolute-zero track: each lesson is one sitting, ends
with something alive on your screen, and introduces exactly one idea. Lesson
one: **a room is just a topic two peers both joined.**

## Build it

\`\`\`
mkdir baby-room && cd baby-room
npm init -y
npm i hyperswarm hypercore-crypto bare bare-process bare-readline
\`\`\`

\`room.js\`:

\`\`\`
const Hyperswarm = require('hyperswarm')
const crypto = require('hypercore-crypto')

const name = process.argv[2] || 'baby-room-hello'
const topic = crypto.hash(Buffer.from('baby-rooms:v1:' + name))

const swarm = new Hyperswarm()
const peers = new Set()

swarm.join(topic, { server: true, client: true })
swarm.on('connection', (socket) => {
  peers.add(socket)
  console.log('* peer joined (' + peers.size + ' online)')
  socket.on('data', (d) => console.log('them:', d.toString().trim()))
  socket.on('error', () => {})
  socket.on('close', () => { peers.delete(socket); console.log('* peer left') })
})

process.stdin.on('data', (line) => {
  for (const p of peers) p.write(line)
})

console.log('room "' + name + '" — waiting for peers…')
\`\`\`

Run \`node room.js secret-club\` in two terminals (better: two machines, two
networks). When \`* peer joined\` prints, type. You are chatting through an
encrypted, holepunched, serverless connection.

## What you just learned

- The room **name never left your machines** — both sides hashed it into a
  topic and met at the hash. Unguessable name ⇒ unguessable room.
- There is **no room object anywhere**. "The room" is only the set of peers
  currently joined to the topic. Close both terminals and it does not exist.
- Messages here are ephemeral and unauthenticated — anyone in the room could
  claim any name. Fixing that is
  [lesson 2](#/learn/rooms-baby-2); making the room *remember* is
  [lesson 3](#/learn/rooms-baby-3).
`
  },

  {
    id: 'rooms-baby-2',
    section: 'rooms',
    title: 'Pear Baby Rooms 2: who said that?',
    minutes: 12,
    summary: 'Keypairs and signatures in the room: prove authorship, keep your name across restarts.',
    body: `
# Pear Baby Rooms 2: who said that?

Lesson 1's room has a flaw you can feel immediately: nothing ties a message to
a sender. Anyone can write \`alice: dinner is cancelled\`. In P2P there is no
server to ask who is who — so we do what the grown-up stack does:
**every message is signed, and your keypair is your name.**
([Identity is a keypair](#/learn/handbook-identity) is the theory version.)

## Add identity

\`\`\`
const crypto = require('hypercore-crypto')
const fs = require('fs')

// Keep the same identity across restarts: persist the keypair.
function loadIdentity (path) {
  if (fs.existsSync(path)) {
    const seed = Buffer.from(fs.readFileSync(path, 'utf8'), 'hex')
    return crypto.keyPair(seed)
  }
  const seed = crypto.randomBytes(32)
  fs.writeFileSync(path, seed.toString('hex'), { mode: 0o600 })
  return crypto.keyPair(seed)
}

const me = loadIdentity('./identity.key')
console.log('you are', me.publicKey.toString('hex').slice(0, 8))
\`\`\`

## Sign everything you send

\`\`\`
function send (text) {
  const payload = Buffer.from(JSON.stringify({ text, ts: Date.now() }))
  const wire = JSON.stringify({
    from: me.publicKey.toString('hex'),
    payload: payload.toString('hex'),
    sig: crypto.sign(payload, me.secretKey).toString('hex')
  }) + '\\n'
  for (const p of peers) p.write(wire)
}
\`\`\`

## Verify everything you receive

\`\`\`
function receive (line) {
  const m = JSON.parse(line)
  const payload = Buffer.from(m.payload, 'hex')
  const ok = crypto.verify(payload, Buffer.from(m.sig, 'hex'),
    Buffer.from(m.from, 'hex'))
  if (!ok) return console.log('!! dropped a forged message')
  const { text } = JSON.parse(payload.toString())
  console.log(m.from.slice(0, 8) + ':', text)
}
\`\`\`

## What you just learned

- **Verify on receive, always.** The socket being encrypted says nothing
  about *authorship* — encryption is the envelope, the signature is the
  handwriting.
- The 8-char hex prefix is a real name: stable across restarts, impossible to
  forge without the secret file. Nicknames can come later as signed
  "profile" messages — decoration on top of the key, never a replacement.
- Messages still vanish when the room empties. Next:
  [a room that remembers](#/learn/rooms-baby-3).
`
  },

  {
    id: 'rooms-baby-3',
    section: 'rooms',
    title: 'Pear Baby Rooms 3: a room that remembers',
    minutes: 12,
    summary: 'Swap loose messages for Hypercores: history, catch-up for latecomers, and offline peers.',
    body: `
# Pear Baby Rooms 3: a room that remembers

Rooms 1–2 are walkie-talkies: miss the moment, miss the message. Real apps
remember. The P2P way is **not** a shared database — it is *everyone keeps
their own signed log, and everyone replicates everyone else's*.
([Everything is a signed log](#/learn/handbook-logs).)

## Each peer writes their own log

\`\`\`
const Corestore = require('corestore')
const store = new Corestore('./room-data')

const mine = store.get({ name: 'baby-rooms/chat' })
await mine.ready()

async function say (text) {
  await mine.append(Buffer.from(JSON.stringify({ text, ts: Date.now() })))
}
\`\`\`

Hypercore signs every block for us — lesson 2's hand-rolled signatures come
for free now.

## Tell peers about your log, replicate theirs

\`\`\`
swarm.on('connection', (socket) => {
  store.replicate(socket)                       // sync every known core
  socket.write(JSON.stringify({ core: mine.key.toString('hex') }) + '\\n')
  socket.on('data', (d) => {
    for (const line of d.toString().split('\\n')) {
      if (!line.trim()) continue
      const theirs = store.get(Buffer.from(JSON.parse(line).core, 'hex'))
      theirs.ready().then(() => follow(theirs))
    }
  })
})

function follow (core) {
  const print = async (i) =>
    console.log(JSON.parse((await core.get(i)).toString()).text)
  for (let i = 0; i < core.length; i++) print(i)      // history!
  core.on('append', () => print(core.length - 1))     // live tail
}
\`\`\`

Start a room, chat, kill everything, restart: **history is still there.**
Join late from a third machine: the first \`follow\` loop backfills everything
you missed.

## What you just learned

- "The room's history" = the union of every member's log. No log is shared;
  no write ever conflicts.
- Latecomer catch-up is just reading logs from 0 — sync is length-compare,
  the reason append-only wins ([the foundations chapter explains why](#/learn/handbook-logs)).
- If everyone sleeps, the room is unreachable — the laptop-lid problem.
  That is [availability](#/learn/handbook-availability), and relays fix it.

You now hold the exact architecture of p2pbuilders — it is this lesson plus
an indexer and anti-spam. Graduate to the
[Storyteller track](#/learn/storyteller-1) to turn logs into a *designed* app.
`
  },

  {
    id: 'storyteller-1',
    section: 'rooms',
    title: 'Storyteller 1: a story is a log',
    minutes: 10,
    summary: 'Designing an op schema — the storytelling app as a worked example of thinking in append-only.',
    body: `
# Storyteller 1: a story is a log

Storyteller is our app-design track. The app: people write stories together,
one passage at a time, each author owning their words. Baby Rooms taught the
plumbing; Storyteller teaches the **thinking** — because in P2P, your real
design surface is not the database schema or the API. It is the **op schema**:
the vocabulary of things a user can *say* into their log.

## Design the ops before anything else

A first pass for Storyteller:

\`\`\`
story_create : { storyId, title, opening }
passage      : { storyId, parent, text }     // parent = passage id it continues
react        : { target, kind }              // ❤ a passage
retract      : { target }                    // tombstone my own op
profile      : { nick, bio }
\`\`\`

Run every candidate op through four questions:

1. **Is it self-contained?** An op is verified alone, possibly years later,
   out of order. \`passage\` carries its \`storyId\` even though "context"
   feels redundant — there is no session to remember it for you.
2. **Does it reference or contain?** Reference by id (\`parent\`, \`target\`),
   never embed copies. The fold stitches the graph.
3. **Can the fold converge?** Two writers continue the same passage — is that
   a conflict? No: store *both*, and the story **branches**. What looked like
   a merge problem becomes the product's best feature. This mindset shift —
   conflicts into structure — is the single most useful P2P design habit.
4. **What happens on abuse?** Anyone can append \`story_create\` with your
   story's id. First-writer-wins on the id, everyone else's ignored
   ([sticky names](#/learn/pattern-data)) — decided in the schema, not
   patched later.

## Version from day one

\`\`\`
{ v: 1, type: 'passage', ts: 1712345678901, payload: { … } }
\`\`\`

Logs are forever — you cannot migrate other people's cores. The \`v\` byte is
how readers three schema versions from now still parse your 2024 ops. Ignore
unknown types and unknown versions politely; peers running old clients are a
permanent fact of life.

Next: several people, one story, and who holds the pen —
[Storyteller 2](#/learn/storyteller-2).
`
  },

  {
    id: 'storyteller-2',
    section: 'rooms',
    title: 'Storyteller 2: passing the pen',
    minutes: 10,
    summary: 'Multi-writer coordination without a server: fold-with-branching vs. Autobase, and choosing between them.',
    body: `
# Storyteller 2: passing the pen

One story, five authors, no server. Who may write the next passage? This
lesson exists because the answer picks your architecture — and because
"whoever holds the pen" is secretly the same question every multi-writer P2P
app must answer. ([Trust without a boss](#/learn/handbook-trust) is the
general theory.)

## Option A: don't coordinate — branch

Everyone appends \`passage\` ops to their own log; the fold builds a tree.
Two continuations of the same parent = two branches. Readers follow the
branch they like; a story is really a *garden* of tellings.

- No coordination, no waiting, works fully offline.
- Perfect when parallel realities are acceptable — often they are better
  than acceptable (this is question 3 from
  [Storyteller 1](#/learn/storyteller-1) paying off).

## Option B: soft convention — the pen token

Keep branching *possible* but make turn-taking the norm: a
\`pass_pen { storyId, to }\` op, honored by UIs (grey out the composer unless
the fold says you hold the pen). Nothing *enforces* it — a rude client can
still append — but every op is signed forever, and the fold can mark
out-of-turn passages so readers see them for what they are. **Social
contract + total visibility** replaces enforcement; most human-scale
coordination needs nothing stronger.

## Option C: real shared state — Autobase

When the product demands one agreed sequence (one canonical story, a shared
membership roster), you need causal ordering and deterministic apply across
writers — exactly what [Autobase](#/learn/hp-autobase) provides: everyone
writes their own input core, one apply function folds them into one view on
every peer.

## Choosing

| need | reach for |
|---|---|
| parallel contributions, order rarely contested | fold + branching (A) |
| human turn-taking, politeness enforceable socially | pen token (B) |
| one canonical sequence, membership, kick/ban | Autobase (C) |

Storyteller ships A + B: branching as the data truth, the pen as the social
layer. p2pbuilders is pure A — votes commute, comments hang off ids, nothing
needs a canonical order. Start at A; each step down the table buys
consistency and costs simplicity. Take the trade only when the product
forces you.
`
  },

  // ── Lessons from our ecosystem ────────────────────────────────────────────

  {
    id: 'eco-authority',
    section: 'eco',
    title: 'The transport carries no authority',
    minutes: 6,
    summary: 'The audit finding that reshaped our engine: trust signatures, never the pipe they arrived through.',
    body: `
# The transport carries no authority

The most important sentence in our codebase, learned the hard way while
hardening peerit (the gossip engine the p2pbuilders web build reuses):

> **A record is trusted because of its signature — never because of who
> delivered it.**

## The bug class

Early gossip code made an innocent-looking assumption: records arriving on a
connection from peer X are peer X's records. But gossip *forwards* — X relays
records authored by Y and Z; that is the entire point. The moment any code
path treated "received from X" as "authored by X", a malicious peer could
inject records under other people's names by just… sending them.

## The fix, as invariants

Our merge now admits a record only if **all** of these hold, regardless of
transport:

1. **The signature verifies** over the canonical encoding of the record.
2. **The signer is the claimed author** — the key that verifies must equal
   the record's \`author\` field, or it is a well-signed lie.
3. **The storage key matches the fields** — a record claiming to be
   \`vote!abc!carol\` must actually be a vote by carol on abc; otherwise a
   valid record can be replayed *at the wrong address* to overwrite state.

Check 3 is the one people miss. Signature verification tells you the bytes
are authentic; it does not tell you they belong where the sender put them.

## Carry-outs

- Do the checks **at ingest** — the boundary where bytes become state — not
  in the UI, not "sometimes".
- Canonical encoding matters: sign a deterministic serialization, or two
  honest peers can disagree about validity.
- Write the adversarial tests (forged sig, wrong author, mis-keyed replay).
  Our engine test does exactly this, and it is the test we would rescue from
  a fire first.

Hypercore gives you 1 and 2 for free within a core. The moment you gossip
records *outside* their author's core — we do, for speed — all three checks
are yours again.
`
  },

  {
    id: 'eco-outbox',
    section: 'eco',
    title: 'Orphan-proof your outbox',
    minutes: 6,
    summary: 'How rotating an identity key silently disappeared posts — and the re-merge that fixed it.',
    body: `
# Orphan-proof your outbox

A war story from the p2pbuilders web build, fixed in a commit bluntly titled
*"orphan-proof the outbox."*

## The setup

In the browser engine, each user maintains an **outbox** — the set of records
they author, stored under a key derived from their identity, gossiped to
peers, merged into everyone's view. Identity lives in browser storage.

## The bug

A user's identity key changes: storage cleared, dev profile switch, a
restore that regenerated the key. The app happily starts a **new outbox**
under the new key. The old outbox — with every post they ever made — is
still on disk. But nothing references it anymore. It never gets gossiped
again from this device. Posts silently fall off the network as other peers'
copies age out.

Nothing *errored*. That is what made it nasty: correctness by luck, data
loss by default.

## The fix

On boot, **re-merge every past outbox, not just the current one**: scan
storage for all outboxes ever written by this device and feed each through
the normal (signature-checking) merge path. Old records are still perfectly
valid — signed by the old key, verifiable by anyone. They flow back into the
view and back into gossip. History survives the key change.

Costs nothing measurable; removes a whole failure class.

## The general lessons

1. **Anything derived from identity is a liability under key rotation.**
   Enumerate what happens to every keyed store when the key changes. "New
   key, fresh everything" is almost never what the user meant.
2. **Old signed data does not need the old secret.** Verification only needs
   the *public* key that is embedded in the records. Never delete data just
   because the signing key is gone.
3. **Watch for silent-orphan shapes everywhere:** renamed storage
   namespaces, changed derivation strings, migrated directories. If a write
   path moved, ask what still points at the old one. The answer "nothing"
   *is* the bug.
`
  },

  {
    id: 'eco-blobs',
    section: 'eco',
    title: 'Seed the blobs core, not just the metadata',
    minutes: 6,
    summary: 'The drive that looked alive but had no bytes: a Hyperdrive is two cores, and relays must pin both.',
    body: `
# Seed the blobs core, not just the metadata

The operational trap of Hyperdrive hosting, which we hit publishing the
p2pbuilders web build to HiveRelay.

## The symptom

Publish the site as a Hyperdrive. Ask relays to pin \`drive.key\`. Relays
accept; status shows replicas across regions. Publisher goes offline.
A visitor opens the site: listings resolve, **every file read hangs.**

## The cause

A [Hyperdrive is two Hypercores](#/learn/hp-hyperdrive): a metadata core
(the file tree — this is what \`drive.key\` names) and a separate
**content/blobs core** holding the actual bytes. Seeding by drive key pinned
the metadata only. The relays could prove the *shape* of the site and serve
none of it. And once the publisher left, the bytes existed nowhere always-on
— the drive was unrecoverable until we came back online.

## The fix

Resolve the blobs core and seed it explicitly, every publish:

\`\`\`
await drive.ready()
const blobs = await drive.getBlobs()
await relay.seed(drive.key)         // metadata core
await relay.seed(blobs.core.key)    // content core — the actual site
\`\`\`

Then verify like you mean it: our publisher waits for **proof a relay
replicated the bytes** (\`waitForDurable\`) before exiting, instead of
trusting an acceptance handshake.

## The general lessons

1. **Know your object graph.** Abstractions that feel like one thing
   (a "drive") are often several replicable units. Pin the closure, not the
   handle.
2. **"Accepted" is not "replicated."** A pin request succeeding means a
   relay *will try*. Durability claims need evidence: bytes confirmed on a
   machine that is not yours.
3. **Test the dead-publisher path.** Publish, kill the publisher, fetch cold
   from another network. It is the only test that means anything for
   availability — and it is exactly the check \`web/check-durable.mjs\` in
   this repo automates.
`
  },

  {
    id: 'eco-antispam',
    section: 'eco',
    title: 'PoW + reputation: honest limits',
    minutes: 7,
    summary: 'What our anti-spam stack actually withstands — published attack math, and why layers beat walls.',
    body: `
# PoW + reputation: honest limits

p2pbuilders is permissionless: keys are free, posting needs nobody's
approval. Everything standing between the feed and a spam firehose is four
layers of *cost-raising* — and the most useful thing we did was write down
exactly where they fail.

## What we run

1. **Proof-of-work** on post/comment/board ops (~80ms / ~20ms / ~1.3s).
   Un-worked ops are refused **at indexing time** — PoW is a policy each
   peer enforces for itself, not a consensus rule
   ([the foundations chapter](#/learn/handbook-trust) has the framing).
2. **Per-key rate limits** at the indexer; violators' cores stay replicated
   (cheap) but stop being indexed (the part that matters) for a cooldown.
3. **Reputation-weighted votes** — weight grows with key age × received
   upvotes, floor 0.02, cap 1.0. Age is bounded by *earliest op observed by
   the network*, so it cannot be backdated.
4. **Subscribable blocklists** — chosen curators, revocable by
   unsubscribing.

## The attack math we published

From the spec's sybil analysis:

| attacker | effective weight | cost |
|---|---|---|
| 100 fresh keys | 2.0 | ~8s of PoW |
| 100 keys aged 30d, 1 mutual upvote | 14.0 | a month of patience |
| 100 keys aged 30d, 10 mutual upvotes | 32.9 | month + coordination |

Reference: one legit 90-day user ≈ 0.93. So a patient cross-voting ring
equals ~35 real users. **v0.1 does not detect voting rings.** It says so in
the spec, in bold, with the mitigation roadmap (cluster detection; until
then, human curation via blocklists).

## Why we design this way

- **Layers, not walls.** Each layer is defeatable; stacked, they push spam
  from "free" to "expensive and slow", which is where communities survive.
- **Raise costs at the index, not the transport.** Replication stays cheap
  and dumb; every peer applies *its own* admission policy. Censorship
  resistance and spam resistance stop being in tension.
- **Publish your attack math.** Writing the sybil table changed our design
  (the 0.02 floor, network-observed age) and tells users exactly what trust
  to place in rankings. Security honesty is a feature.
`
  },

  // ── Build articles ────────────────────────────────────────────────────────

  {
    id: 'build-terminal',
    section: 'builds',
    title: 'Building the terminal HN',
    minutes: 8,
    summary: 'How the p2pbuilders TUI is put together: one readline loop, a backend of ops, and scope cuts that shipped it.',
    body: `
# Building the terminal HN

p2pbuilders shipped as a **terminal app**: \`pear run pear://…\` drops you at
a \`›\` prompt on a live P2P board. This article is how it is built and the
decisions that got it out the door.

## Architecture

Two halves, cleanly split:

- **Backend** (\`src/backend/\`): the Node class (Corestore + one Hypercore
  per identity), the op schema, PoW minting/checking, the Hyperbee indexer
  that folds every tracked core into hot/new/top views, reputation, rate
  limits, and a Hyperswarm layer with a protomux announce channel. All
  runtime-portable via one \`_rt.js\` shim ([Bare walkthrough](#/learn/hp-bare)).
- **Terminal UI** (\`src/terminal/main.js\`): a single readline loop over a
  tiny state machine — feed view, thread view, compose mode. Commands are
  first-word dispatch (\`submit\`, \`open 3\`, \`up 2\`, \`reply\`, …). ANSI
  colors and a screen-clear redraw; a debounce coalesces peer-driven
  refreshes so gossip storms do not flicker the screen.

Everything crosses one JSON-RPC dispatch layer — the same method surface the
dev HTTP/WS server and the (parked) iOS pipe use. The UI cannot reach into
internals; every transport gets the same API.

## Decisions that shipped it

- **Reddit-shaped → HN-shaped.** Boards + browsable lists were most of the UI
  scope. One \`front\` feed cut it to a screen and a half of rendering; the
  *data model* kept the \`board\` field, so the pivot cost nothing on-chain.
- **TUI first.** The desktop GUI stack fought us (install-time timeouts), so
  the terminal became the product. A readline loop has no build step, runs
  identically under Bare and Node, and made the P2P parts — the actual hard
  parts — the whole job.
- **Compose mode over flags.** Multi-line posts arrive as a tiny modal state:
  type lines, \`.\` submits, \`:q\` cancels. The whole editor is ~60 lines.
- **Constants over admin systems.** Moderation is one \`ADMIN_PUBKEY\`
  constant enforced *by the indexer* (admin tombstones are honored for any
  target; everyone else, own ops only). Pinned posts are a hardcoded opId
  list. Governance-by-recompile is honest for the current scale — the
  enforcement point (indexer, not UI) is what makes it real.

## What it proved

41 tests cover every layer; the same backend booted under raw Bare (the iOS
milestone) without changes. The bet that "the app is the log + the fold, the
UI is whatever is cheapest today" — the whole premise of the
[foundations track](#/learn/handbook-logs) — held.
`
  },

  {
    id: 'build-web',
    section: 'builds',
    title: 'One engine, two apps: porting to the browser',
    minutes: 8,
    summary: 'The PearBrowser port: reusing peerit’s gossip engine verbatim, and the one hook it needed to stay generic.',
    body: `
# One engine, two apps: porting to the browser

The browser build of p2pbuilders (\`web/\`) runs as a PearBrowser P2P site —
same permissionless board, no terminal required. The interesting part of the
port is what we *did not* write.

## The reuse bet

Our earlier app peerit (a P2P Reddit) had already been hardened into a
generic gossip engine: Ed25519 identity, canonical signing, the
signature-authority verification gauntlet
([The transport carries no authority](#/learn/eco-authority)), per-user
outboxes, and a last-write-wins gossip merge. That layer is app-agnostic —
seven modules reused **verbatim**: \`crypto.js\`, \`verify.js\`, \`sync.js\`,
\`gossip.js\`, \`identity.js\`, \`markdown.js\`, \`util.js\`.

What p2pbuilders added on top: an HN record schema, proof-of-work, reputation
weighting, HN ranking, the social graph, and the UI. The engine did not know
what a "post" was before, and still does not.

## The one change the engine needed

PoW gating has to happen **at ingest** — un-worked records must never enter
the view, no matter who relays them. But hashcash is an app policy; baking it
into the engine would have ended the genericity. The resolution: a single
\`validate\` **admit hook** — the engine calls it on every record before
merge, the app supplies the PoW check. One seam, both properties kept. Where
you put the seam is the difference between "shared library" and "fork".

## Browser realities

- **Same schema, different spelling:** records keyed like
  \`post!<board>!<cid>\`, \`vote!<target>!<voter>\` — LWW where the terminal
  app has an append-only log, converging on the same shapes
  ([Data patterns](#/learn/pattern-data)).
- **Crypto:** SubtleCrypto Ed25519 where available; a loudly-labeled insecure
  dev fallback where not (the status chip tells you which world you are in).
- **Transport:** on PearBrowser, \`window.pear.sync\` bridges to the real
  swarm; on a plain dev server, localStorage cooperation simulates peers —
  open two tabs, switch users, watch gossip.

## Lesson

Port the *engine boundary*, not the app. The terminal and web builds share
almost no code — they share **invariants**: signed records, verify-on-ingest,
fold-to-view. That is the part worth keeping identical, because it is the
part that holds the security model.
`
  },

  {
    id: 'build-relay',
    section: 'builds',
    title: 'HiveRelay: dumb storage that keeps P2P online',
    minutes: 7,
    summary: 'The relay fleet behind our apps — pin-by-key, durability proofs, and why relays must stay dumb.',
    body: `
# HiveRelay: dumb storage that keeps P2P online

Every app in our ecosystem leans on
[HiveRelay](https://github.com/bigdestiny2/P2P-Hiverelay): a fleet of
always-on nodes (5+ relays, 3 continents) that pin Hypercores so data
survives its author going offline —
[the laptop-lid problem](#/learn/handbook-availability), operationalized.

## The contract

A relay does exactly one thing: **given a 32-byte key, replicate it and keep
serving it.** No indexing, no validation beyond Hypercore's own signatures,
no moderation, no accounts. This dumbness is a security decision:

- Nothing to forge — logs are author-signed end-to-end; a relay is an
  untrusted mirror by construction.
- Nothing to subpoena into an authority — a relay cannot alter or
  selectively rewrite content without breaking signatures.
- Losing relays degrades availability, never integrity.

## How apps use it

The client library speaks to the fleet: \`seed(pubkey)\` requests pinning
with a replica count; acceptances come back per relay with regions. The
p2pbuilders TUI seeds **your core and every author you track** on boot and
as discovery finds them — availability spreads with attention, invisibly.
The \`relays\` command shows who is pinning you right now.

For sites and app bundles, \`publish()\` wraps files into a Hyperdrive and
seeds it — **both** cores, after
[the blobs-core incident](#/learn/eco-blobs).

## Operational lessons

1. **Durability needs proof, not promises.** Acceptance means "will try".
   The publisher waits for evidence a relay holds the bytes
   (\`waitForDurable\`) before it exits, and re-checks on a loop when asked
   to babysit. Separately, an archive tier re-heals replicas (≥7 across ≥4
   regions) without the publisher.
2. **Pins are leases, not tombs.** TTLs plus periodic re-announce from live
   clients keep storage bounded and data fresh — set-and-forget pinning
   grows forever.
3. **Regions are part of the API.** Acceptances report region codes so a
   client can *verify* geographic spread instead of hoping.

## The line we hold

Every feature request that would make relays smarter — search, feeds,
moderation — gets the same answer: that is edge work. The fleet stays a
cache tier apps *prefer* but never *require*. The moment peers cannot work
without relays, we have rebuilt servers with extra steps.
`
  },

  // ── Patterns for P2P apps ─────────────────────────────────────────────────

  {
    id: 'pattern-data',
    section: 'patterns',
    title: 'Data patterns: logs, LWW, tombstones, sticky names',
    minutes: 9,
    summary: 'The recurring shapes for P2P state: single-writer logs, fold-to-view, last-write-wins, hide-don’t-delete, first-writer-wins.',
    body: `
# Data patterns

The state-shaped patterns we reach for in every app. Steal freely.

## 1. Single-writer log, many-reader fold

**The** foundational pattern
([handbook chapter](#/learn/handbook-logs)). Each identity appends ops to
its own signed log; every peer folds all followed logs through a pure
reducer into a local view. No shared mutable state, no write conflicts, sync
is length-compare. Use unless the product *demands* one canonical shared
sequence (then: [Autobase](#/learn/hp-autobase)).

## 2. Op schema with version byte

Ops are \`{ v, type, ts, payload }\`. \`v\` first — logs are forever and you
cannot migrate other people's cores
([Storyteller 1](#/learn/storyteller-1)). Readers skip unknown types and
versions without erroring: old clients are permanent.

## 3. Reference, never contain

Ops point at targets by id (\`vote.target\`, \`comment.parent\`); the fold
stitches the graph. Deterministic ids — author key + sequence number, or a
content hash — cost nothing and never collide.

## 4. Last-write-wins records (with a real tiebreaker)

For "current value" state (profiles, votes, follows): key the record
(\`vote!<target>!<voter>\`), keep the highest \`(ts, deterministic-tiebreak)\`
version. The tiebreak (compare hashes, compare authors — anything total)
matters: equal timestamps happen constantly, and peers that break ties
differently never converge.

## 5. Tombstones — hide, don't delete

Append-only means no erasure; "delete" is an op that conforming indexers
honor by hiding the target ([the foundations track is honest about this](#/learn/handbook-logs)).
Enforce authorship *in the fold* — a tombstone only applies if its author
may delete the target (owner, or a role your app defines — p2pbuilders
honors admin tombstones for any target, everyone else's for their own).
Never rely on the writing client being polite.

## 6. First-writer-wins (sticky) names

Human-readable names in a system with no registry: first
\`board_create\` / \`story_create\` observed for a name wins; later claims
are ignored by the fold. An established name cannot be hijacked — even by a
claim with a *backdated* timestamp, which is why "first observed", plus a
deterministic tiebreak for genuine races, beats "earliest claimed". Squatting
on brand-new names remains possible; say so, and let social pressure handle
it.

## 7. Keyspace design is query design

Views live in ordered stores ([Hyperbee](#/learn/hp-hyperbee)); prefixes are
tables, ranges are queries, inverted timestamps give newest-first. Design
keys the way you would design indexes.
`
  },

  {
    id: 'pattern-network',
    section: 'patterns',
    title: 'Network patterns: topics, gossip, validate-on-ingest',
    minutes: 8,
    summary: 'The connectivity shapes: derived topics, key gossip, admission control at the merge, and relay pinning.',
    body: `
# Network patterns

How P2P apps *connect* — the shapes we reuse everywhere.

## 1. Derived, versioned topics

Rendezvous points are hashes anyone can derive:
\`hash('myapp:board:v1:' + name)\`
([discovery chapter](#/learn/handbook-discovery)). Version them; a protocol
break moves to \`:v2:\` instead of confusing old peers. Secret names give
unlisted rooms for free ([Baby Rooms 1](#/learn/rooms-baby-1)).

## 2. Gossip pointers, replicate content

Never gossip content — gossip **keys** (author pubkeys, drive keys) and let
verified replication move the bytes. Fake pointers are harmless (their
content self-verifies or fails); fake content is impossible if it is never
accepted outside signed logs. p2pbuilders' announce channel spreads author
keys transitively: one connection bootstraps the whole board's roster.

## 3. Validate on ingest — the admit hook

Every byte crossing from network to state passes one gate that checks
*everything*: signature over canonical encoding, signer == claimed author,
storage-key/field consistency, app policy (PoW, size caps). The engine keeps
one seam (\`validate\`) so policy stays app-side
([how the web port kept its engine generic](#/learn/build-web)). Scattered
"we check later" is how
[transport-authority bugs](#/learn/eco-authority) happen.

## 4. Enforce at the index, not the transport

Replication stays promiscuous and cheap; *indexing* is where policy bites
(refuse un-worked ops, rate-limit keys, apply blocklists). Peers disagreeing
about policy still interoperate — each just shows a different view
([why](#/learn/eco-antispam)).

## 5. Relay pinning as a cache tier

Always-on dumb storage keeps data alive through author downtime
([HiveRelay](#/learn/build-relay)): seed yourself and everyone you track,
verify durability with proof not acceptances, pin the *full object graph*
([blobs incident](#/learn/eco-blobs)) — and keep the app fully functional
with zero relays reachable.

## 6. Design for churn

Peers vanish mid-anything. Every handler must survive a socket dying between
two lines; every sync must be resumable from any length. The test: kill
either peer at a random moment, restart, converge. If that test scares you,
the design is not done.
`
  },

  {
    id: 'pattern-app',
    section: 'patterns',
    title: 'App patterns: local-first UI, optimistic writes, honest status',
    minutes: 8,
    summary: 'Product-layer shapes: render from the local view, mint-then-show, identity UX, and telling users the truth.',
    body: `
# App patterns

The product-layer shapes — what makes a P2P app feel like an app instead of
a protocol demo.

## 1. Render from the local view, always

The UI reads **only** the local fold ([Hyperbee views](#/learn/hp-hyperbee),
merged gossip state) — never "the network". Boot offline shows everything
you had; peers arriving just makes it fresher. This single rule delivers
offline-first as a side effect and makes loading states nearly disappear:
the data is already here.

## 2. Optimistic writes with visible cost

Your own ops apply locally the instant they are minted — your post is on
screen before any peer has it. When writes carry proof-of-work, show the
mint honestly (\`minting pow… 80ms\`, a live counter on the submit button):
perceived honesty beats fake instancy, and it teaches users the spam gate
exists.

## 3. Soft refresh, never stomp input

Gossip arrives mid-keystroke. Debounce re-renders, and **skip them while
focus is in an input** — we learned to check \`document.activeElement\`
before repainting, and the TUI equivalent (never redraw over compose mode).
Losing a half-typed comment to a refresh is the fastest way to lose a user.

## 4. Identity UX: keys under names

Show nicknames, resolve them from signed profile records, fall back to
\`anon-<keyprefix>\` — and keep the real key one tap away for out-of-band
verification ([identity chapter](#/learn/handbook-identity)). Offer key
backup/export early; there is no recovery flow to save anyone later. For
dev builds: multi-identity switching (our dev user switcher) turns
one browser into a test network.

## 5. Honest status surfaces

A P2P app should always answer: how many peers, how many records, which
transport, is crypto real? Our web build's status chip
(\`gossip-bridge · 3p · 214 recs\`) and the TUI header
(\`hot · 4 peers · tracking 12\`) exist because trust in a serverless app
comes from *legibility* — including showing when you are in an insecure dev
fallback, loudly.

## 6. Moderation as user power, not platform power

Local blocks apply instantly to your own view; published blocklists let
others *opt in* to your curation; unsubscribing un-moderates
([trust chapter](#/learn/handbook-trust)). The app's job is making these
levers visible — not deciding for anyone.

## 7. Ship the smallest honest surface

Our whole product history in one pattern: Reddit-shape → HN-shape cut the UI
by half while the data model kept boards; the GUI stalled so the TUI
shipped; pinned posts are a constant in a file
([the build article](#/learn/build-terminal)). In P2P the hard risks live in
the protocol layer — spend UI ambition *after* the network works.
`
  }
]

// ---- helpers ---------------------------------------------------------------

export function lessonById (id) {
  return LESSONS.find(l => l.id === id) || null
}

export function lessonsBySection () {
  const m = new Map()
  for (const s of SECTIONS) m.set(s.id, { section: s, lessons: [] })
  for (const l of LESSONS) {
    const g = m.get(l.section)
    if (g) g.lessons.push(l)
  }
  return [...m.values()]
}

// Flat numbering used by the terminal app (`learn 7`) — stable order:
// sections as declared, lessons as declared within each.
export function numberedLessons () {
  const out = []
  for (const { lessons } of lessonsBySection()) out.push(...lessons)
  return out
}
