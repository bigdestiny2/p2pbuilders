'use strict'

// M5: end-to-end HTTP + WebSocket RPC smoke test.

const assert = require('assert/strict')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const WebSocket = require('ws')
const { start } = require('../src/backend/server')

const tests = []
function test (name, fn) { tests.push({ name, fn }) }

function fetchText (url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }))
      res.on('error', reject)
    }).on('error', reject)
  })
}

function rpcClient (url) {
  const ws = new WebSocket(url)
  const pending = new Map()
  let id = 1
  const ready = new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
  })
  return {
    ready,
    call (method, params) {
      const reqId = id++
      return new Promise((resolve, reject) => {
        pending.set(reqId, { resolve, reject })
        ws.send(JSON.stringify({ id: reqId, method, params }))
      })
    },
    close () { ws.close() }
  }
}

async function waitFor (pred, { timeoutMs = 5000, intervalMs = 20 } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await pred()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

test('server boots, serves index.html and static assets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2pbuilders-m5-'))
  const app = await start({ dir, port: 0, swarm: null })
  const port = app.server.address().port

  const root = await fetchText(`http://localhost:${port}/`)
  assert.equal(root.status, 200)
  assert.ok(root.body.includes('p2pbuilders'))

  const css = await fetchText(`http://localhost:${port}/styles.css`)
  assert.equal(css.status, 200)
  assert.ok(css.body.includes('--accent'))

  const js = await fetchText(`http://localhost:${port}/app.js`)
  assert.equal(js.status, 200)
  assert.ok(js.body.includes('WebSocket'))

  // SPA fallback: arbitrary route returns index.html
  const fallback = await fetchText(`http://localhost:${port}/b/anything`)
  assert.equal(fallback.status, 200)
  assert.ok(fallback.body.includes('<title>p2pbuilders</title>'))

  await app.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('WebSocket RPC: createBoard → createPost → listPosts → vote → comment', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2pbuilders-m5-'))
  const app = await start({ dir, port: 0, swarm: null })
  const port = app.server.address().port
  const client = rpcClient(`ws://localhost:${port}/rpc`)
  await client.ready

  const me = await client.call('me')
  assert.ok(me.pubkey && me.pubkey.length === 64)

  await client.call('createBoard', { name: 'meta', description: 'about p2pbuilders itself' })

  // createBoard is fire-and-indexed; let the indexer catch up
  await waitFor(async () => {
    const boards = await client.call('listBoards')
    return boards.includes('meta')
  })

  const b = await client.call('getBoard', { name: 'meta' })
  assert.equal(b.description, 'about p2pbuilders itself')

  const { opId } = await client.call('createPost', {
    board: 'meta',
    title: 'hello',
    body: 'this is the first post',
    link: null
  })
  assert.ok(opId && opId.length === 80)

  // Let indexer see the post
  await waitFor(async () => {
    const posts = await client.call('listPosts', { board: 'meta' })
    return posts.length === 1
  })

  const posts = await client.call('listPosts', { board: 'meta' })
  assert.equal(posts[0].title, 'hello')
  assert.equal(posts[0].body, 'this is the first post')
  assert.equal(posts[0].commentCount, 0)

  // Vote on it
  await client.call('vote', { targetOpId: opId, dir: 1 })
  await waitFor(async () => {
    const t = await client.call('getVoteTotals', { opId })
    return t.up === 1
  })

  // Comment on it
  const { opId: cId } = await client.call('createComment', {
    parentOpId: opId,
    body: 'nice'
  })
  assert.ok(cId)

  await waitFor(async () => {
    const cs = await client.call('listComments', { parentOpId: opId })
    return cs.length === 1
  })

  const comments = await client.call('listComments', { parentOpId: opId })
  assert.equal(comments[0].body, 'nice')

  client.close()
  await app.close()
  fs.rmSync(dir, { recursive: true, force: true })
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
