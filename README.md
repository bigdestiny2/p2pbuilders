# p2pbuilders

A permissionless, peer-to-peer Hacker News clone on the [Pear](https://docs.pears.com/) + [Bare](https://github.com/holepunchto/bare) stack. Single feed, one hypercore per identity, hashcash-gated posts, reputation-weighted voting. Posts are mirrored across the [p2p-hiverelay](https://github.com/bigdestiny2/P2P-Hiverelay) network so they stay online when authors close their laptops.

## Try it

Install Pear once:

```
npm i -g pear
pear                            # bootstraps the runtime
export PATH="$HOME/Library/Application Support/pear/bin:$PATH"
```

Run p2pbuilders:

```
pear run pear://gopfpwat99tcuaakasfnftrds3j6t7srdmi3qidbhm9xeizt1a5y
```

Type `help` at the prompt.

## What's in here

```
src/
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
├── terminal/
│   └── main.js       the Pear terminal entry (readline UI)
├── bare/
│   ├── harness.js    Pear/bare-kit shared backend bootstrap
│   └── ios-entry.js  bare-kit-pear iOS entry
├── pear/
│   └── worker.js     Pear desktop worker (parked)
└── relay/
    └── server.js     self-hosted hiverelay with @hyperswarm/dht-relay endpoint

public/               HTML/CSS/JS for the browser/desktop UI (dev mode)
ios-app/              minimal Xcode project using bare-kit-pear (parked)
scripts/
  publish.js          publish a directory to hiverelay
  seed-pear.js        ask hiverelay to seed a pear:// key
  probe-relays.mjs    list relays currently pinning a key
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
git clone <this-repo>
cd p2pbuilders
npm install

# run the Node dev server (browser at http://localhost:8787)
npm run dev

# run the terminal app under standalone Bare (no Pear needed)
./node_modules/bare/bin/bare src/terminal/main.js

# run the full test suite (41 tests)
npm test
```

## Stage a new build to Pear

```
# 1. make sure /tmp/p2pbuilders symlinks to this project (Pear chokes on paths
#    containing spaces inside pear-electron/pre)
ln -sfn "$(pwd)" /tmp/p2pbuilders

# 2. stage from the space-free path
cd /tmp/p2pbuilders
pear stage --no-ask dev .          # prints pear://0.<n>.<key>

# 3. run it
pear run pear://<that-key>
```

## Seed an app or user to hiverelay

```
node scripts/publish.js             # publish ./public as a hyperdrive
node scripts/seed-pear.js pear://<pear-key>
node scripts/probe-relays.mjs       # see which relays are pinning it
```

## Status

**Shipping now:**
- Terminal app via `pear run pear://…`
- Full backend verified with 41 tests
- Auto-seeding to the public hiverelay network

**Parked:**
- Pear desktop GUI — `pear-electron/pre` keeps timing out on some installs; the scaffolding is in [src/pear/](./src/pear/) for when we revisit.
- iOS via [bare-kit-pear](https://github.com/bigdestiny2/bare-kit-pear) — entry at [src/bare/ios-entry.js](./src/bare/ios-entry.js), Swift integration in [ios-app/](./ios-app/) ready to build in Xcode.
- PearBrowser — would require a rewrite onto `window.pear.sync`'s Autobase model. See [SPEC.md §11.3](./SPEC.md).

## License

Apache 2.0. See [LICENSE](./LICENSE).
