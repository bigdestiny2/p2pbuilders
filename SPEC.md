# P2PBuilders — Spec v0.1

A permissionless, peer-to-peer, Reddit-style messageboard on the Pear/Bare stack.

No servers, no central moderators, no account registration. Every user runs a node; the board is the sum of everyone's signed append-only logs.

---

## 1. Goals & non-goals

**Goals**
- Hacker News-shaped UX: **single feed**, title + optional URL + optional text body, threaded comments, upvote-driven ranking.
- Permissionless posting — anyone can spin up a key and start posting.
- Basic antispam/sybil resistance without a central authority.
- Works offline-first; syncs when online; stays available via hiverelay when author is offline.
- Small, auditable op schema that won't need a painful migration in 6 months.

**Non-goals (for v0.1)**
- Sub-feeds / subreddits — the data model supports boards but the UI defaults to a single `front` feed.
- Private/DM threads.
- Rich media (images/video) — text + external links only.
- Federation with non-Pear systems.
- Strong sybil resistance (e.g. proof-of-stake, social graph verification). We target "raise the cost of spam," not "prevent sybils."

> **Pivot note (v0.1a):** p2pbuilders was originally designed Reddit-shaped (boards + browsable board list). We've pivoted to HN-shaped because it dramatically narrows UI scope. The **data model retains the `board` field on posts** (everything on-chain still supports multiple boards); we just always post to `front` by default and hide the board-chooser from the primary UI. Power users can still query other boards via the backend API.

---

## 2. Stack

| Layer          | Choice                    | Why                                      |
| -------------- | ------------------------- | ---------------------------------------- |
| Runtime        | Pear (desktop) + Bare     | P2P-native, no browser sandbox limits    |
| Storage        | Corestore + Hypercore     | Signed append-only log per identity       |
| Index          | Hyperbee                  | Ordered queries over folded state         |
| Discovery      | Hyperswarm (DHT)          | Topic-based peer finding                 |
| Always-on      | p2p-hiverelay             | Keeps user cores seeded when offline      |
| Crypto         | `sodium-universal`        | Ed25519 sigs, blake2b hashes              |
| Serialization  | `compact-encoding` (cenc) | Deterministic, versionable binary format |

---

## 3. Identity

- On first launch, each user generates a random **32-byte primary key** and persists it locally (mode 0600).
- The user's **personal Hypercore** is derived by Corestore from `(primaryKey, "p2pbuilders/user")`. Its **public key** is the user's global identity, referenced as `pubkey` throughout the spec.
- No usernames, no registry — nicknames are advisory (see `profile` op).
- All of a user's ops live in that single personal Hypercore. Hypercore signs every block with the derived keypair; op-level authenticity is implicit, no per-op signatures.
- Secrets-to-protect: **the primary key**. If it leaks, someone else can write to your core. If you lose it, you lose your identity — there is no recovery path in v0.1.
- Users MAY publish a `profile` op (nickname, bio, avatar blob key) as block 0 of their core.

---

## 4. Data model

### 4.1 Ops (all encoded with `compact-encoding`)

Every block in a user's core is one op. Version byte is first to allow forward-compatible migrations.

```
Op := {
  v:        uint8              // schema version, starts at 1
  type:     uint8              // 1=post 2=comment 3=vote 4=edit 5=tombstone
                               // 6=follow 7=block 8=profile
                               // 9=board_create 10=blocklist_publish
  ts:       uint64             // author-claimed ms timestamp (advisory)
  payload:  <type-specific>
  pow?:     { bits: uint8, nonce: buffer }   // required on post/comment/board_create
}
```

### 4.2 Op IDs

`opId = authorPubkey ++ blockSeq` (40 bytes). Deterministic, collision-free, no hashing required. Posts, comments, votes all referenced this way.

### 4.3 Type payloads

```
post:            { board: string, title: string, body: string, link?: string }
comment:         { parent: opId, body: string }       // parent is post OR comment
vote:            { target: opId, dir: int8 }          // +1 or -1; 0 = retract
edit:            { target: opId, body: string, title?: string }
tombstone:       { target: opId }
follow:          { target: pubkey }
block:           { target: pubkey, public: bool }     // public=true → gossipable
profile:         { nick: string, bio?: string, avatar?: blobKey }
board_create:    { name: string, description: string, minPowBits: uint8 }
blocklist_publish: { list: [pubkey], version: uint32 }
```

Board names are lowercase `[a-z0-9_-]{2,32}`. First `board_create` op observed for a name wins; later ones are ignored.

---

## 5. Proof of work (antispam layer 1)

Fast and simple. Applied to `post`, `comment`, and `board_create` ops.

### 5.1 Algorithm

```
digest = blake2b(cenc.encode(opWithoutPow))
target = 2^(256 - bits)
find nonce such that blake2b(digest ++ nonce) < target
```

### 5.2 Parameters

| Op             | Default bits | Rough time on M-class laptop |
| -------------- | ------------ | ---------------------------- |
| `comment`      | 16           | ~20 ms                       |
| `post`         | 18           | ~80 ms                       |
| `board_create` | 22           | ~1.3 s                       |

Boards MAY declare `minPowBits` higher than defaults (e.g. for busy boards). Peers refuse to index ops below the board's declared minimum.

PoW is non-authoritative — it's an indexing policy, not a consensus rule. A peer can accept anything it wants into its local view; the default indexer rejects under-PoW ops.

### 5.3 Why not heavier PoW?

We want sub-second for regular use. This is a speed-bump, not a wall. Layers 2–4 do the rest.

---

## 6. Antispam layers 2–4

### 6.1 Rate limits (layer 2)

Default indexer policy (per-peer, configurable):

- 10 posts/hour per pubkey
- 60 comments/hour per pubkey
- 600 votes/hour per pubkey

Violations cause the indexer to drop that core's subsequent ops for a cooldown (1h → 24h on repeat). Core is still replicated (cheap), just not indexed.

### 6.2 Reputation weighting (layer 3)

```
rep(key)        = log2(1 + max(ageDays, 1/24)) * sqrt(1 + receivedUpvotes)
voteWeight(key) = clamp(rep(key) / 50, 0.02, 1.0)
```

`ageDays` is bounded by the earliest op observed across the network — not author-claimed — to prevent backdating.

Sort orders (hot/top) use weighted vote sums. Raw vote counts still shown in the UI.

#### 6.2.1 Simulation results

| Scenario                      | Weight   |
| ----------------------------- | -------- |
| Brand new (floor)             | 0.020    |
| 1 day, lurker                 | 0.020    |
| 7 days, 5 upvotes             | 0.147    |
| 30 days, 10 upvotes           | 0.329    |
| 90 days, 50 upvotes           | 0.929    |
| 365 days, 500 upvotes         | 1.000    |
| Viral day-1 post, 1000 upvts  | 0.633    |

The **0.02 floor** means new users can always upvote; they just don't move the needle until they stick around.

#### 6.2.2 Sybil cost analysis

| Attacker setup                              | Effective weight | Cost                            |
| ------------------------------------------- | ---------------- | ------------------------------- |
| 100 fresh keys, no cross-voting             | 2.0              | ~8s PoW, rate-limited           |
| 100 keys aged 30d, 1 mutual upvote each     | 14.0             | 30d patience                    |
| 100 keys aged 30d, 10 mutual upvotes each   | 32.9             | 30d patience + coordinated PoW  |

Reference: a legit 90-day user with 50 upvotes has weight 0.93. The worst attacker row above ≈ 35 legit users. **Acceptable for v0.1 as a speed bump. Not acceptable as the final answer.**

#### 6.2.3 Known weakness: cross-voting rings

The table in §6.2.2 shows cross-voting is the real attack. v0.1 does **not** detect it. Future work (v0.2+):

- Cluster detection: if a set of keys overwhelmingly upvotes each other relative to the rest of the network, discount their mutual votes.
- Per-curator blocklists (§6.3) already let humans flag rings manually.

This limitation is called out explicitly so nobody thinks PoW + rep = sybil-proof. It isn't.

### 6.3 Blocklists (layer 4)

- Every user maintains a **local blocklist**. Blocked keys' ops are hidden from their UI.
- Users MAY publish a `blocklist_publish` op. Others can **subscribe** — treating that curator's blocks as their own.
- No forced moderation. A board is whatever your subscribed blocklists let through.
- Sybil mitigation: a handful of widely-subscribed curators creates de-facto moderation without giving anyone board ownership.

---

## 7. Discovery & replication

### 7.1 Topics

- **Per-board topic**: `blake2b('p2pbuilders:board:v1:' + boardName)` → Hyperswarm topic.
- **Global roster topic**: `blake2b('p2pbuilders:roster:v1')` — peers gossip known user-core keys here. Bootstraps new nodes.

### 7.2 Protocol on connect

1. Exchange capabilities (version, supported op types).
2. Exchange **core-key manifests**: "I have these author cores at these lengths."
3. Replicate cores of interest (any core active in subscribed boards).
4. Gossip new core keys seen since last sync.

### 7.3 Hiverelay

- User configures one or more hiverelay endpoints.
- Relay pins the user's own core (and optionally friends' cores) so posts stay reachable when the author is offline.
- Relay is **dumb storage** — it does not validate, moderate, or index. Pure availability.

---

## 8. Local indexer

Runs in a Bare worklet. Consumes ops from all replicated cores, writes to a local Hyperbee.

### 8.1 Keyspaces

```
post/<board>/new/<ts>/<opId>            → opId
post/<board>/hot/<score>/<opId>         → opId   // periodically rescored
comment/<parentOpId>/<ts>/<opId>        → opId
vote/<targetOpId>/<voterPubkey>         → dir    // last-write-wins by blockSeq
user/<pubkey>/posts/<ts>                → opId
board/<name>                            → board_create op
rep/<pubkey>                            → cached reputation
```

### 8.2 Scoring

Hot score (reddit-like, weighted):
```
score = log10(max(1, |weightedVotes|)) * sign(weightedVotes)
      + (ts - epoch) / 45000
```
Recomputed on a 60s cadence for posts <24h old, 10m cadence otherwise.

### 8.3 Handling edits/tombstones

- `edit` → indexer overlays latest edit when reading; original block stays.
- `tombstone` → indexer hides target from views but keeps it for audit; operator can force-unindex.
- Only the author of an op can edit or tombstone it (enforced by "op and target share the same core").

---

## 9. UI surfaces (v0.1 — HN-shaped)

- **Front page** — single ranked feed. Default sort: `hot` (HN-style score/age decay). Alternative: `new`.
- **Thread view** — submission + nested comments. Comments sorted by score within siblings.
- **Submit** — title + optional URL + optional text. Shows PoW progress (fast but honest).
- **Profile** — your pubkey, nickname, karma, key age, blocked users, configured relays.

### 9.1 HN hot ranking

```
hot(post) = (max(0, weightedScore) + 1)^0.8 / ((hoursOld + 2)^1.8)
```

- `weightedScore` from §6.2 (reputation-weighted).
- `+1` so new zero-score posts aren't invisible.
- Age penalty dominates after ~1 day; posts fall off the front naturally.

---

## 10. Resolved decisions & open questions

### Resolved (v0.1)

1. **Board squatting** — accepted. First `board_create` wins. Boards are just names; social pressure sorts out the good ones.
2. **Vote privacy** — votes are public and signed.
3. **Edit history** — UI shows latest only; full history available via "view source" / raw op inspection.
4. **Reputation formula** — simulated (see §6.2.1–§6.2.3). Floor added at 0.02. Cross-voting rings flagged as known weakness, deferred to v0.2.
5. **Hiverelay defaults** — minimum 2 relays per user recommended in onboarding (not enforced).

### Still open

6. **Content deletion / "right to forget".** Tombstones hide but don't delete — signed ops persist in replicated cores forever. This is a real UX + legal problem (GDPR-style requests, CSAM, doxxing). **Deferred, but must be answered before any public launch.** Options to evaluate later:
    - Accept the limitation; educate users that "delete" means "hide."
    - Cryptographic shredding: encrypt payloads with per-op keys; "delete" = destroy the key. Relays keep ciphertext, readers can't decrypt.
    - Opt-in append-only "mute at indexer" — every conforming indexer agrees to stop serving tombstoned content. Best-effort, not enforceable.

---

## 11. Milestones

Shipped in v0.1 (all green, see `npm test` — 41 tests):

1. **M1 — Core.** Identity, op encoding, PoW, single-user local write/read. No networking.
2. **M2 — Replication.** Corestore + Hyperswarm; two nodes see each other's posts on a shared board.
3. **M3 — Peer discovery.** Protomux announce channel; auto-trackUser on board join; transitive discovery (C learns A via B).
4. **M4 — Indexer.** Local Hyperbee views — hot/new/top, comment threads, vote tallies, board registry.
5. **M5 — UI.** HTTP + WebSocket RPC dev transport; HN-shaped SPA frontend (browser/mobile-safe).
6. **M6 — Antispam.** PoW gate, per-pubkey rate limits, reputation weighting, local blocklists.
7. **M7 — Hiverelay (self-hosted).** Relay mode seeds announced cores 24/7 for offline authors.
8. **M8 — Hardening.** Edit/tombstone overlays (author-only enforcement), profile op indexing.
9. **M9 — Transports.** Pear desktop worker + IPC (no HTTP bridge); `@hyperswarm/dht-relay` WebSocket endpoint on hiverelay.
10. **M10 — Bare runtime.** `src/backend/_rt.js` shim; `src/bare/harness.js` + `src/bare/ios-entry.js` boot the full backend under raw Bare, verified by a subprocess smoke test. iOS path via bare-kit-pear uses this entry.
11. **M11 — MVP UX.** `listCommentTree` RPC + nested comment rendering; edit/delete buttons on owned items; primary-key backup + reveal/copy on `/me`; first-launch onboarding (`/welcome`).

### 11.1 Transport matrix

| Runtime                 | How UI talks to backend                                | State                              |
| ----------------------- | ------------------------------------------------------ | ---------------------------------- |
| Pear desktop            | `Pear.Worker.run('./src/pear/worker.js')` + pipe       | Verified: backend loads under      |
|                         |                                                        | Bare (test/m10-bare.js).           |
| iOS via bare-kit-pear   | Kit loads `src/bare/ios-entry.js`; host pipes JSON-RPC | Entry written, pipe wiring ready   |
|                         |                                                        | for kit integration.               |
| Node + any browser (dev)| `http://localhost:8787` + WebSocket `/rpc`             | Working, tested.                   |
| Raw browser (no Bare)   | dht-relay + browser-built hypercore/corestore          | **Blocked.** See §11.2.            |

### 11.2 iOS via bare-kit-pear (primary mobile path)

Since bare-kit-pear ships a Bare runtime inside an iOS app, our Node-style backend runs on iOS unmodified — the whole reason we isolated `fs`/`path`/`os` through `src/backend/_rt.js`. The SDK is expected to:

1. Load `src/bare/ios-entry.js` into the embedded Bare runtime.
2. Hand us a duplex pipe (`bare-ipc` or `Bare.IPC.connect()`).
3. Drive the UI natively (or via a webview) and send framed JSON-RPC over the pipe.

The RPC surface is identical to what the dev-mode WebSocket server exposes — same method names, same shape. A native iOS view controller posts `{"id":1,"method":"listPosts","params":{}}` and gets back a feed.

### 11.3 Raw browser client — still parked

Without Bare, browser-only clients (regular Safari, non-Pear Chrome) still hit the corestore-7/hypercore-11 storage blocker. Three options from before remain, but they're no longer urgent because bare-kit-pear covers iOS:

- **(a) Downgrade** to `corestore@5`/`hypercore@10` + `random-access-idb`.
- **(b) Target PearBrowser's `window.pear.sync` API** (Autobase-based).
- **(c) Wait for a Bare web-runtime.**

Parked. Revisit if real demand for non-Pear-browser access shows up.
