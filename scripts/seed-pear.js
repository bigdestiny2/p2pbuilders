'use strict'

// scripts/seed-pear.js — ask public HiveRelay relays to pin a Pear drive key.
//
// Usage:
//   node scripts/seed-pear.js <pearKey | pear://... URL>
//
// Example:
//   node scripts/seed-pear.js pear://fa91f7z8x6qp3fcfbi7zaggnw6w7ncab96qiaswemmoufjjeod6y
//
// Stays running until Ctrl+C so the local replica is also available while
// relays are catching up.

const path = require('path')

async function main () {
  const input = process.argv[2]
  if (!input) {
    console.error('usage: node scripts/seed-pear.js <pearKey | pear://...>')
    process.exit(1)
  }

  // Normalize: "pear://<possibly-versioned-prefix>.<key>" → bare z32 key string.
  // Pear links look like:  pear://<key>  or  pear://<channel>.<key>  or  pear://0.<length>.<key>
  let key = input.replace(/^pear:\/\//, '')
  const lastDot = key.lastIndexOf('.')
  if (lastDot >= 0) key = key.slice(lastDot + 1)

  console.log(`[seed] target key: ${key}`)

  const storageDir = path.resolve('.hiverelay-seed')
  const b4a = require('b4a')
  const { HiveRelayClient } = await import('p2p-hiverelay/client')

  const client = new HiveRelayClient(storageDir)
  await client.start()
  console.log(`[seed] client started, discovering relays…`)

  // Small wait for relay discovery to populate
  await new Promise(r => setTimeout(r, 3000))

  // HiveRelayClient.seed accepts either a hex string or a buffer. Our key is
  // z-base-32 (Pear's format); convert via hypercore-id-encoding if needed.
  let keyBuf
  try {
    // Try z32 decode first — Pear keys are z-base-32.
    const { default: hypercoreId } = await import('hypercore-id-encoding')
    keyBuf = hypercoreId.decode(key)
  } catch {
    // Fallback: treat as hex
    try { keyBuf = b4a.from(key, 'hex') } catch {}
  }
  if (!keyBuf || keyBuf.length !== 32) {
    console.error(`[seed] could not decode key "${key}" to 32 bytes`)
    process.exit(1)
  }

  console.log(`[seed] requesting seed on ${keyBuf.length} relays…`)

  try {
    const acceptances = await client.seed(keyBuf, { replicas: 3, timeout: 30000 })
    console.log(`[seed] seeded on ${acceptances.length} relay(s)`)
    for (const a of acceptances) {
      const id = a.pubkey ? b4a.toString(a.pubkey, 'hex').slice(0, 12) : 'unknown'
      console.log(`  - relay ${id}`)
    }
  } catch (err) {
    console.error(`[seed] seed request failed: ${err.message}`)
  }

  console.log('[seed] staying online. press Ctrl+C to stop.')
  process.on('SIGINT', async () => {
    console.log('\n[seed] shutting down…')
    await client.close?.().catch(() => {})
    process.exit(0)
  })
  setInterval(() => {
    const peers = client.swarm?.connections?.size ?? 0
    console.log(`[seed] peers=${peers}`)
  }, 30000).unref()
}

main().catch((err) => {
  console.error('[seed] fatal:', err.stack || err.message)
  process.exit(1)
})
