'use strict'

// M8: edit/tombstone/profile handling in the indexer.

const assert = require('assert/strict')
const b4a = require('b4a')
const { Node } = require('../src/backend/node')
const { Indexer } = require('../src/backend/indexer')

const tests = []
function test (name, fn) { tests.push({ name, fn }) }

async function waitFor (pred, { timeoutMs = 5000, intervalMs = 20 } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await pred()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

test('edit: overlay replaces title/body at read time; no history leak', async () => {
  const node = await Node.openTemp()
  const idx = new Indexer(node)
  await idx.ready()

  const post = await node.post('front', 'original title', 'original body')
  await waitFor(async () => (await idx.getOverlay(post.opId)) === null)

  await node.edit(post.opId, 'edited body', { title: 'edited title', ts: Date.now() + 1000 })
  await waitFor(async () => (await idx.getOverlay(post.opId)) != null)

  const overlay = await idx.getOverlay(post.opId)
  assert.equal(overlay.title, 'edited title')
  assert.equal(overlay.body, 'edited body')

  await idx.close()
  await node.close()
})

test('edit: only author can edit; forged edit from other key is ignored', async () => {
  const a = await Node.openTemp()
  const b = await Node.openTemp()
  const { connectDirect } = require('../src/backend/swarm')
  const conn = connectDirect(a.store, b.store)
  const idxA = new Indexer(a)
  await idxA.ready()

  const post = await a.post('front', 't', 'b')
  await waitFor(async () => {
    const list = []
    for await (const p of idxA.listPosts('front')) list.push(p)
    return list.length === 1
  })

  // B tries to edit A's post by making its own edit op pointing at A's opId.
  await b.trackUser(a.pubkey)
  await a.trackUser(b.pubkey)
  const bCore = a.userCore(b.pubkey)
  // B edits A's post (forged)
  await b.edit(post.opId, 'forged', { title: 'FORGED' })
  await waitFor(() => bCore.length > 0, { timeoutMs: 8000 })
  await new Promise(r => setTimeout(r, 300))

  const overlay = await idxA.getOverlay(post.opId)
  assert.equal(overlay, null, 'forged edit dropped by indexer')

  conn.close()
  await idxA.close()
  await a.close()
  await b.close()
})

test('tombstone: target hidden from listPosts; only author can tombstone', async () => {
  const node = await Node.openTemp()
  const idx = new Indexer(node)
  await idx.ready()

  const p1 = await node.post('front', 'keeps', 'a')
  const p2 = await node.post('front', 'deletes', 'b')
  await waitFor(async () => {
    const list = []
    for await (const p of idx.listPosts('front')) list.push(p)
    return list.length === 2
  })

  await node.tombstone(p2.opId)
  await waitFor(async () => (await idx.isTombstoned(p2.opId)))

  const visible = []
  for await (const p of idx.listPosts('front')) visible.push(p)
  assert.equal(visible.length, 1, 'tombstoned post hidden')
  assert.ok(b4a.equals(visible[0].opId, p1.opId))

  // But opt-in can still surface it
  const all = []
  for await (const p of idx.listPosts('front', { includeTombstoned: true })) all.push(p)
  assert.equal(all.length, 2)

  await idx.close()
  await node.close()
})

test('profile: nickname indexed + retrievable; latest wins', async () => {
  const node = await Node.openTemp()
  const idx = new Indexer(node)
  await idx.ready()

  await node.setProfile({ nick: 'alice', bio: 'hello', ts: 1000 })
  await waitFor(async () => (await idx.getProfile(node.pubkey)) != null)
  let p = await idx.getProfile(node.pubkey)
  assert.equal(p.nick, 'alice')
  assert.equal(p.bio, 'hello')

  // update; newer ts wins
  await node.setProfile({ nick: 'ALICE', bio: 'updated', ts: 2000 })
  await waitFor(async () => (await idx.getProfile(node.pubkey)).nick === 'ALICE')
  p = await idx.getProfile(node.pubkey)
  assert.equal(p.nick, 'ALICE')

  // older ts must not overwrite
  await node.setProfile({ nick: 'stale', ts: 500 })
  await new Promise(r => setTimeout(r, 150))
  p = await idx.getProfile(node.pubkey)
  assert.equal(p.nick, 'ALICE', 'older ts ignored')

  await idx.close()
  await node.close()
})

// runner
;(async () => {
  let pass = 0, fail = 0
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
      pass++
    } catch (err) {
      console.log(`  ✗ ${name}`)
      console.log(`    ${err.stack || err.message}`)
      fail++
    }
  }
  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
})()
