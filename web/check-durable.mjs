#!/usr/bin/env node
// check-durable.mjs — TRUE durability probe. With NO host of mine running, open
// the drive from a fresh store and actually READ a file — which forces fetching
// the content/blobs core from whatever peer serves it. If a relay serves the
// file with all my hosts down, the drive is genuinely durable. Exit 0 = durable.
import { HiveRelayClient } from '/Users/localllm/Projects/pear-ecosystem/00-core/hiverelay/packages/client/index.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const KEY = process.argv[2] || 'ac1977a75cc84b46af0af8bb559cd4ebbe10507eb0f51d863e289d09635f6d74'
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

const client = new HiveRelayClient({ storage: join(__dir, '.hiverelay-probe') })
await client.start()
await sleep(4000)

let fileOk = false, fileLen = 0, durable = null
try {
  const drive = await client.open(KEY, { wait: true, timeout: 30000 })
  await drive.ready()
  try { const buf = await withTimeout(drive.get('/index.html'), 60000); fileOk = !!(buf && buf.length); fileLen = buf ? buf.length : 0 } catch {}
  if (typeof client.waitForDurable === 'function') {
    try { durable = await client.waitForDurable(drive.key, { timeoutMs: 40000, minPeers: 1 }) } catch {}
  }
} catch (e) { console.log('[probe] open error:', e.message) }

console.log('PROBE ' + JSON.stringify({ key: KEY, fileOk, fileLen, durable }))
try { if (client.destroy) await client.destroy() } catch {}
process.exit(fileOk ? 0 : 2)
