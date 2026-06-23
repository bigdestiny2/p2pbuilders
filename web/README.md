# p2pbuilders (browser)

Permissionless peer-to-peer **Hacker News** for anons who build P2P — ported from
the terminal app to a **PearBrowser P2P site**. No servers, no accounts. Posts are
**proof-of-work** gated, votes are **reputation-weighted**, and boards, threaded
comments, follows and subscribable blocklists replicate directly between peers.

```
hyper://<driveKey>/        ← open in PearBrowser
```

It reuses **peerit's gossip engine verbatim** — the signature-authority + per-user-
outbox + gossip-merge layer is app-agnostic. p2pbuilders only adds an HN schema,
PoW, reputation weighting, the social graph, and a Hacker-News UI.

## What's shared vs. new

| Reused from peerit (unchanged) | New for p2pbuilders |
|---|---|
| `crypto.js` (Ed25519), `verify.js`, `sync.js`, `gossip.js`, `identity.js`, `markdown.js`, `util.js` | `canon.js`/`model.js` (HN schema), `pow.js`, `reputation.js`, `ranking.js`, `data.js`, `prefs.js`, `app.js` |

The engine gained one generic extension — a `validate` admit hook — so PoW can
gate ingestion without making the engine app-specific.

## How it works

- **Identity / authenticity:** every record is Ed25519-signed; the gossip merge
  honors a record only if its signature verifies, its signer is its claimed author,
  and its storage key matches its fields. The transport carries no authority. (Same
  model peerit was hardened to after a multi-agent audit.)
- **Proof-of-work (`pow.js`):** submitting a post/comment/board requires finding a
  SHA-256 nonce with N leading zero bits (post 16, comment 14, board 18). The proof
  binds to the op's immutable identity (cid/author/createdAt), is part of the signed
  record, and is **re-verified by every peer on ingest** via the engine's `validate`
  hook — so unworked posts never enter the network. Cheap once (~0.2s), costly to spam.
- **Reputation-weighted votes (`reputation.js`):** a vote's weight scales with the
  voter's age + received upvotes (`clamp(log2(1+ageDays)·√(1+received)/50, 0.02, 1)`),
  so fresh keys count but barely move ranking. Displayed "points" are raw net votes;
  ranking uses the weighted score.
- **HN ranking (`ranking.js`):** `(score+1)^0.8 / (hoursOld+2)^1.8`.
- **Boards** are first-creator-sticky names (can't be hijacked once established).
- **Social graph:** published `follow`, public `block`, and subscribable `blocklist`
  records; subscribing to a curator's blocklist hides those keys for you.

## Schema (keys for the gossip generic reducer)

```
board      board!<name>                    (sticky; creator owns it)
post       post!<board>!<cid>
comment    comment!<postCid>!<cid>          (parentCid threads it)
vote       vote!<targetCid>!<voter>         (one per voter, LWW)
profile    profile!<author>
follow     follow!<author>!<target>
block      block!<author>!<target>
blocklist  blocklist!<author>
```

## Run it

```bash
cd 02-apps/p2pbuilders
node dev-server.mjs          # serves public files on 127.0.0.1:8778 (no-store)
# open http://localhost:8778  — click "load demo", use the account menu → switch user to simulate peers
```

In PearBrowser (real bridge): `node publish.mjs --local` prints a `hyper://` key and
hosts the drive; open it in PearBrowser. The same code runs on `window.pear.sync/
identity/swarm` (the `BridgeGossipSync` path) — the status chip shows `gossip-bridge`.

## Test

```bash
node test/engine.mjs   # 24 checks: PoW gate, reputation, HN ranking, gossip data flow,
                       # sticky boards, follow/blocklist, profiles
```

## Publish (outward-facing — run deliberately)

```bash
node publish.mjs        # publish + seed to live HiveRelay + register in catalog
KEEP=1 node publish.mjs  # stay online so relays anchor the drive
```

## Honest limitations
- **Sybil:** identities are free, so reputation weighting *blunts* but doesn't
  eliminate ballot-stuffing. PoW raises the cost of mass posting; neither is a wall.
- **Board-name squatting:** an established board can't be hijacked, but the first
  claimant of a brand-new name wins it (no global naming authority in pure gossip).
- **Dev fallback:** a browser without SubtleCrypto Ed25519 runs an insecure
  cooperative mode (status chip shows it). PearBrowser / modern browsers / Node 20+
  all enforce signatures.
