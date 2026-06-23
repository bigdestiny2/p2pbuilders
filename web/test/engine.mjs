// engine.mjs — headless verification of the p2pbuilders browser port:
// PoW gate, reputation weighting, HN ranking, and the full gossip data flow
// (boards/posts/comments/votes/follow/blocklist) across two peers.
// Run: node test/engine.mjs

import assert from 'node:assert'
import { GossipSync, makeHub, mergeOutboxes } from '../js/gossip.js'
import { DevIdentity } from '../js/identity.js'
import { createData } from '../js/data.js'
import { canonical } from '../js/canon.js'
import { mint, verify, makeValidator } from '../js/pow.js'
import { weight } from '../js/reputation.js'
import { sortPosts, hotScore } from '../js/ranking.js'
import { ready as cryptoReady, isSecure } from '../js/crypto.js'

const BITS = { post: 6, comment: 5, board: 7 } // low difficulty for fast tests
let passed = 0
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m) }
function mem () { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) } }

async function makePeer (hub, name) {
  const id = new DevIdentity(mem(), mem()); await id.ready(); await id.createUser(name)
  const validate = makeValidator(BITS)
  const sync = new GossipSync({ storage: mem(), bus: hub.connect(), getMe: () => id.me().pubkey, validate })
  await sync.ready()
  return { id, sync, data: createData(sync, id, { minBits: BITS }), pub: id.me().pubkey, name }
}

async function main () {
  await cryptoReady()
  ok(isSecure(), 'crypto backend available')

  console.log('\n— proof of work —')
  const idA = new DevIdentity(mem(), mem()); await idA.ready()
  const A = idA.me().pubkey
  const post = { cid: 'abc', board: 'front', author: A, createdAt: 1000 }
  post.pow = await mint('post', post, 6)
  ok(await verify('post', post, 6), 'minted PoW verifies at its difficulty')
  ok(!(await verify('post', post, 12)), 'PoW rejected when difficulty floor is higher')
  const tampered = { ...post, cid: 'xyz' } // identity changed -> proof no longer valid
  ok(!(await verify('post', tampered, 6)), 'PoW is bound to the op identity (tamper fails)')

  console.log('\n— reputation weighting —')
  ok(weight(0, 0) === 0.02, 'fresh key floors at 0.02')
  ok(weight(90, 50) > weight(30, 10) && weight(30, 10) > weight(0, 0), 'weight grows with age + received upvotes')
  ok(weight(99999, 99999) <= 1, 'weight is clamped to 1')

  console.log('\n— PoW gate at the merge boundary —')
  const goodPost = { id: 'front!p1', cid: 'p1', board: 'front', title: 'hi', url: '', text: '', author: A, createdAt: 2000, editedAt: 0, deleted: false }
  goodPost.pow = await mint('post', goodPost, 6)
  const s = await idA.sign(canonical('post', goodPost)); Object.assign(goodPost, { _sig: s.signature, _k: s.publicKey, _dk: s.driveKey, _ns: s.namespace, _alg: s.algorithm })
  const validate = makeValidator(BITS)
  let merged = await mergeOutboxes([{ pub: A, view: { 'post!front!p1': goodPost } }], {}, validate)
  ok(merged['post!front!p1'], 'a PoW-backed, signed post is admitted')
  const noPow = { ...goodPost }; delete noPow.pow
  const s2 = await idA.sign(canonical('post', noPow)); const noPow2 = { ...noPow, _sig: s2.signature, _k: s2.publicKey, _dk: s2.driveKey, _ns: s2.namespace, _alg: s2.algorithm }
  merged = await mergeOutboxes([{ pub: A, view: { 'post!front!p1': noPow2 } }], {}, validate)
  ok(!merged['post!front!p1'], 'a signed post WITHOUT proof-of-work is rejected at ingest')

  console.log('\n— two-peer data flow —')
  const hub = makeHub()
  const alice = await makePeer(hub, 'alice')
  const bob = await makePeer(hub, 'bob')

  await alice.data.createBoard({ name: 'p2p' })
  ok(await bob.data.getBoard('p2p'), 'bob sees the board alice created (PoW-gated, gossiped)')
  const p = await alice.data.submitPost({ board: 'p2p', title: 'Show P2PB: peerit', url: 'hyper://x' })
  ok((await bob.data.listPostsIn('p2p')).some(x => x.cid === p.cid), "bob sees alice's post")
  const c = await bob.data.addComment({ postCid: p.cid, board: 'p2p', body: 'nice work' })
  ok((await alice.data.listComments(p.cid)).some(x => x.cid === c.cid), "alice sees bob's comment")

  console.log('\n— reputation-weighted votes —')
  await alice.data.vote(p.cid, 'post', 1)
  await bob.data.vote(p.cid, 'post', 1)
  const t = await alice.data.tallyFor(p.cid)
  ok(t.up === 2 && t.score === 2, 'raw tally counts both upvotes')
  ok(t.weighted > 0 && t.weighted <= 2, 'weighted score is positive but reputation-discounted')

  console.log('\n— HN ranking —')
  const now = Date.now()
  ok(hotScore(50, now, now) > hotScore(50, now - 48 * 3600000, now), 'newer post outranks older at equal score')
  const ranked = sortPosts([{ cid: 'a', createdAt: now, score: 1 }, { cid: 'b', createdAt: now, score: 9 }], 'top')
  ok(ranked[0].cid === 'b', 'top sort ranks higher score first')

  console.log('\n— sticky boards (no hijack) —')
  const claimed = {}
  const bd = { id: 'own', name: 'own', description: '', creator: alice.pub, createdAt: 5000 }
  bd.pow = await mint('board', bd, 7); const bs = await alice.id.sign(canonical('board', bd)); Object.assign(bd, { _sig: bs.signature, _k: bs.publicKey, _dk: bs.driveKey, _ns: bs.namespace, _alg: bs.algorithm })
  await mergeOutboxes([{ pub: alice.pub, view: { 'board!own': bd } }], claimed, validate)
  ok(claimed.own === alice.pub, 'first board creator is locked in')
  const hijack = { id: 'own', name: 'own', description: 'mine now', creator: bob.pub, createdAt: 0 }
  hijack.pow = await mint('board', hijack, 7); const hs = await bob.id.sign(canonical('board', hijack)); Object.assign(hijack, { _sig: hs.signature, _k: hs.publicKey, _dk: hs.driveKey, _ns: hs.namespace, _alg: hs.algorithm })
  const m2 = await mergeOutboxes([{ pub: alice.pub, view: { 'board!own': bd } }, { pub: bob.pub, view: { 'board!own': hijack } }], claimed, validate)
  ok(m2['board!own'].creator === alice.pub, 'createdAt:0 cannot hijack an established board')

  console.log('\n— social graph —')
  await alice.data.follow(bob.pub)
  ok((await alice.data.following(alice.pub)).includes(bob.pub), 'alice follows bob (published)')
  await alice.data.unfollow(bob.pub)
  ok(!(await alice.data.following(alice.pub)).includes(bob.pub), 'unfollow removes from following')
  // bob curates a blocklist; alice subscribes -> the listed key is blocked for alice
  await bob.data.publishBlocklist(['spammerPubkeyXYZ'])
  const blocked = await alice.data.blockedSet([], [bob.pub])
  ok(blocked.has('spammerPubkeyXYZ'), 'subscribing to a curator blocklist blocks its keys')
  const notBlocked = await alice.data.blockedSet([], [])
  ok(!notBlocked.has('spammerPubkeyXYZ'), 'unsubscribed = not blocked')

  console.log('\n— profiles —')
  await alice.data.setProfile({ nick: 'alice', bio: 'builds p2p' })
  ok((await alice.data.nickOf(alice.pub)) === 'alice', 'nick resolves from profile')
  ok((await bob.data.nickOf('deadbeef00')).startsWith('anon-'), 'unknown key shows anon handle')

  console.log(`\n✅ all ${passed} p2pbuilders engine checks passed\n`)
}

main().catch(e => { console.error('\n❌ FAILED:', e.message, '\n', e.stack); process.exit(1) })
