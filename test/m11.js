'use strict'

// M11 — MVP feature additions:
//   - listCommentTree: returns nested comments flat, with parent pointers
//   - exportPrimaryKey: reveals the identity key
//   - edit/delete still work over RPC

const assert = require('assert/strict')
const b4a = require('b4a')
const { Node } = require('../src/backend/node')
const { Indexer } = require('../src/backend/indexer')
const { createRPC } = require('../src/backend/rpc')

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

test('exportPrimaryKey returns 64-char hex', async () => {
  const node = await Node.openTemp()
  const idx = new Indexer(node); await idx.ready()
  const rpc = createRPC({ node, indexer: idx })

  const { hex } = await rpc.dispatch('exportPrimaryKey')
  assert.match(hex, /^[0-9a-f]{64}$/)
  assert.equal(b4a.toString(node.primaryKey, 'hex'), hex)

  await idx.close(); await node.close()
})

test('listCommentTree returns nested descendants, not just direct children', async () => {
  const node = await Node.openTemp()
  const idx = new Indexer(node); await idx.ready()
  const rpc = createRPC({ node, indexer: idx })

  const { opId } = await node.post('front', 't', 'root')
  const rootHex = b4a.toString(opId, 'hex')

  const c1 = await node.comment(opId, 'child of post', { ts: 1 })
  const c2 = await node.comment(c1.opId, 'grandchild', { ts: 2 })
  await node.comment(c2.opId, 'great-grandchild', { ts: 3 })
  await node.comment(opId, 'sibling of c1', { ts: 4 })

  await waitFor(async () => {
    const tree = await rpc.dispatch('listCommentTree', { rootOpId: rootHex })
    return tree.length === 4
  })

  const tree = await rpc.dispatch('listCommentTree', { rootOpId: rootHex })
  assert.equal(tree.length, 4, '4 descendants total')

  // Parent pointers should form a valid chain
  const byId = Object.fromEntries(tree.map((c) => [c.opId, c]))
  const parents = tree.map((c) => c.parent)
  // Count: 2 children of root, 1 child of c1, 1 child of c2
  const parentCounts = new Map()
  for (const p of parents) parentCounts.set(p, (parentCounts.get(p) || 0) + 1)
  assert.equal(parentCounts.get(rootHex), 2, 'two direct replies to root')

  // The great-grandchild should exist and reference c2
  const greats = tree.filter((c) => c.body === 'great-grandchild')
  assert.equal(greats.length, 1)
  assert.equal(byId[greats[0].parent].body, 'grandchild')

  await idx.close(); await node.close()
})

test('listCommentTree respects maxNodes cap', async () => {
  const node = await Node.openTemp()
  const idx = new Indexer(node); await idx.ready()
  const rpc = createRPC({ node, indexer: idx })

  const post = await node.post('front', 't', 'b')
  for (let i = 0; i < 20; i++) await node.comment(post.opId, `c${i}`, { ts: i })

  await waitFor(async () => {
    const tree = await rpc.dispatch('listCommentTree', {
      rootOpId: b4a.toString(post.opId, 'hex')
    })
    return tree.length >= 10
  })

  const capped = await rpc.dispatch('listCommentTree', {
    rootOpId: b4a.toString(post.opId, 'hex'),
    maxNodes: 5
  })
  assert.equal(capped.length, 5)

  await idx.close(); await node.close()
})

test('editOp + deleteOp via RPC surface the overlay/tombstone', async () => {
  const node = await Node.openTemp()
  const idx = new Indexer(node); await idx.ready()
  const rpc = createRPC({ node, indexer: idx })

  const { opId } = await node.post('front', 'original', 'body')
  const hex = b4a.toString(opId, 'hex')

  await waitFor(async () => (await rpc.dispatch('getPost', { opId: hex })) != null)

  await rpc.dispatch('editOp', { opId: hex, body: 'edited body', title: 'edited title' })
  await waitFor(async () => {
    const p = await rpc.dispatch('getPost', { opId: hex })
    return p.title === 'edited title'
  })
  const edited = await rpc.dispatch('getPost', { opId: hex })
  assert.equal(edited.body, 'edited body')
  assert.equal(edited.edited, true)

  await rpc.dispatch('deleteOp', { opId: hex })
  await waitFor(async () => (await idx.isTombstoned(opId)))

  // Deleted posts disappear from listPosts
  const posts = await rpc.dispatch('listPosts', { board: 'front' })
  assert.equal(posts.find((p) => p.opId === hex), undefined)

  await idx.close(); await node.close()
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
