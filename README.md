# p2pbuilders

A permissionless, peer-to-peer Hacker News clone that lives **entirely in your terminal**. One feed, one hypercore per identity, hashcash-gated posts, reputation-weighted voting — built on the [Pear](https://docs.pears.com/) + [Bare](https://github.com/holepunchto/bare) stack. Posts are mirrored across the [p2p-hiverelay](https://github.com/bigdestiny2/P2P-Hiverelay) network so they stay online when authors close their laptops.

It's a **TUI** — no browser, no webview, no GUI. You run one command and drive the whole board from the `›` prompt.

Repo: https://github.com/bigdestiny2/p2pbuilders · Live: `pear run pear://dqz1e6fwyrz1mxj7eqsmcar3hnegrj491t5hnqjm9mda9tz8dzfy`

## Try it

Install Pear once:

```
npm i -g pear
pear                            # bootstraps the runtime
export PATH="$HOME/Library/Application Support/pear/bin:$PATH"
```

Run p2pbuilders:

```
pear run pear://dqz1e6fwyrz1mxj7eqsmcar3hnegrj491t5hnqjm9mda9tz8dzfy
```

You'll land on the feed. Type `help` at the `›` prompt, or `submit "hello"` to say hi.

## Using it

The whole app is keyboard-driven from the `›` prompt. Type `help` any time to see this list in-app.

**Feed**

| command | what it does |
| --- | --- |
| `submit` | new post — opens the multi-line editor |
| `submit "title" <body>` | new post in one line |
| `open <n>` | open the thread for post #n |
| `up <n>` / `down <n>` | vote post #n up or down |
| `sort <hot\|new\|top>` | change how the feed is ordered |
| `refresh` / `r` | reload the feed |

**Inside a thread**

| command | what it does |
| --- | --- |
| `reply` | reply — opens the multi-line editor |
| `reply <body>` | reply in one line |
| `up` / `down` | vote on the post you're viewing |
| `back` / `b` | return to the feed |

**Compose editor** (after `submit` / `reply` with no inline text)

| key | what it does |
| --- | --- |
| `<your text>` | any line joins the body |
| `.` | submit — on its own line |
| `:q` | cancel |

**Moderation**

| command | what it does |
| --- | --- |
| `delete <n>` | delete a post (author, or admin for anyone) |
| `delete` | delete the thread you're viewing |

**Identity + infra**

| command | what it does |
| --- | --- |
| `nick <name>` | set your nickname |
| `me` | show your pubkey + stats |
| `relays` | which relays are pinning you (or the current thread's author) |
| `opid <n>` | print a post's opId |
| `quit` / `q` | exit |

> Posts and comments carry a small proof-of-work (~80ms / ~20ms), so there's a brief `minting pow…` pause before they land. That's normal.

## What's in here

```
src/
├── terminal/
│   └── main.js       ← THE APP. the Pear terminal (TUI) entry — readline feed/thread UI
├── backend/          shared Node/Bare backend (ops, PoW, indexer, reputation, antispam)
│   ├── ops.js        signed append-only op schema (post, comment, vote, edit, tombstone,
│   │                 follow, block, profile, board_create, blocklist_publish)
│   ├── pow.js        blake2b hashcash — ~80ms on post, ~20ms on comment
│   ├── node.js       Node class: wraps corestore/hypercore for a user identity
│   ├── indexer.js    local hyperbee folding all replicated cores into queryable views
│   ├── reputation.js age + received-upvote weighted voting
│   ├── swarm.js      hyperswarm + protomux announce channel for peer discovery
│   ├── rpc.js        JSON-RPC dispatch shared by every transport
│   └── server.js     optional Node HTTP/WS dev server
├── bare/
│   ├── harness.js    Pear/bare-kit shared backend bootstrap
│   └── ios-entry.js  bare-kit-pear iOS entry (parked)
├── pear/
│   └── worker.js     Pear desktop worker (parked)
└── relay/
    └── server.js     self-hosted hiverelay with @hyperswarm/dht-relay endpoint

landing/              static site for p2pbuilders.com
public/               parked browser/desktop UI (dev mode) — not the terminal app
ios-app/              minimal Xcode project using bare-kit-pear (parked)
scripts/
  publish.js          publish a directory to hiverelay
  seed-pear.js        ask hiverelay to seed a pear:// key
  probe-relays.mjs    list relays currently pinning the live key
test/                 41 tests covering every layer
```

## How it works

**Identity** — each user is a single hypercore keyed by a 32-byte primary key stored locally by Corestore. The public key is the user's global identity; there's no signup or central registry.

**Ops** — every block in a user's core is one signed op (post/comment/vote/edit/tombstone/etc.). Hypercore's built-in block signatures authenticate every op automatically.

**PoW** — posts, comments, and board creation carry a blake2b hashcash nonce. Default difficulty: 18 bits for posts (~80ms), 16 for comments (~20ms). The indexer refuses to index under-PoW ops.

**Reputation** — `weight = clamp(log2(1 + ageDays) * sqrt(1 + received) / 50, 0.02, 1.0)`. New keys always get a 0.02 floor (you can vote from day one; you just don't move the needle until you stick around). Full table: see [SPEC.md](./SPEC.md) §6.2.

**Discovery** — users find each other via Hyperswarm on a deterministic topic hash. A protomux "announce" channel gossips known pubkeys; anyone joining a board auto-tracks everyone else's hypercore within seconds.

**Persistence** — on boot, the terminal client asks [p2p-hiverelay](https://github.com/bigdestiny2/P2P-Hiverelay) to seed its own hypercore + every peer it tracks. With 5+ relays across 3 continents, posts outlive the author's uptime.

**Moderation** — an `ADMIN_PUBKEY` constant (one identity) can delete anyone's posts. Normal users can only delete their own. The indexer enforces the rule — admin-authored tombstones are honored regardless of target, others are dropped unless the author matches.

## Develop

```
git clone https://github.com/bigdestiny2/p2pbuilders.git
cd p2pbuilders
npm install

# run the terminal app (TUI) under standalone Bare — no Pear needed
./node_modules/bare/bin/bare src/terminal/main.js

# run the optional Node dev server (browser at http://localhost:8787)
npm run dev

# run the full test suite (41 tests)
npm test
```

## Stage a new build to Pear

Staging publishes the current working tree to a `pear://` link that anyone can `pear run`.

```
# 1. symlink to a space-free path (Pear chokes on paths with spaces in
#    pear-electron/pre).
ln -sfn "$(pwd)" /tmp/p2pbuilders
cd /tmp/p2pbuilders

# 2. generate a fresh link (once per app — reuse it for later builds)
pear touch                                   # prints pear://<key>

# 3. sync the working tree to that link
pear stage --no-ask pear://<key> .           # prints pear://0.<n>.<key>

# 4. point the unversioned link at this build, so `pear run pear://<key>`
#    serves what you just staged
pear release pear://<key> .

# 5. run it
pear run pear://<key>
```

## Keep it online (seed to hiverelay)

```
node scripts/seed-pear.js pear://<key>   # ask relays to pin the app (or any user core)
node scripts/probe-relays.mjs            # see which relays are pinning the live key
node scripts/publish.js                  # publish ./public as a hyperdrive
```

`seed-pear.js` stays running so your local replica is available while relays catch up — leave it up, or Ctrl+C once `seeded on N relay(s)` prints.

## Status

**Shipping now:**
- Terminal app (TUI) via `pear run pear://…`
- Full backend verified with 41 tests
- Auto-seeding to the public hiverelay network

**Parked:**
- Pear desktop GUI — `pear-electron/pre` keeps timing out on some installs; the scaffolding is in [src/pear/](./src/pear/) for when we revisit.
- iOS via [bare-kit-pear](https://github.com/bigdestiny2/bare-kit-pear) — entry at [src/bare/ios-entry.js](./src/bare/ios-entry.js), Swift integration in [ios-app/](./ios-app/) ready to build in Xcode.
- PearBrowser — would require a rewrite onto `window.pear.sync`'s Autobase model. See [SPEC.md §11.3](./SPEC.md).

## License

Apache 2.0. See [LICENSE](./LICENSE).
