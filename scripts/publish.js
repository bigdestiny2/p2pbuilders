'use strict'

// scripts/publish.js — ship the p2pbuilders frontend to the HiveRelay network.
//
// Usage:
//   node scripts/publish.js                    # publish ./public with auto-seeding
//   node scripts/publish.js --dir ./public     # explicit dir
//   node scripts/publish.js --encryption-key <hex>  # blind mode (relay stores ciphertext only)
//
// Prints the drive key on success. Share that key with:
//   - PearBrowser:      pear://<key>          (or hyper://<key>/ if that's the URL scheme)
//   - HTTP gateway:     http://<relay>:9100/v1/hyper/<key>/index.html
//
// The script keeps the process alive for ~30s to give DHT announce time to
// propagate, then exits. The drive remains seeded by the relay network; you
// can close this process.

const path = require('path')
const fs = require('fs')

async function main () {
  const args = parseArgs(process.argv.slice(2))

  const dir = path.resolve(args.dir || 'public')
  const encryptionKey = args['encryption-key'] || null
  const storageDir = path.resolve(args.storage || '.hiverelay-publish')

  if (!fs.existsSync(dir)) {
    console.error(`[publish] directory not found: ${dir}`)
    process.exit(1)
  }

  console.log(`[publish] publishing ${dir}`)
  console.log(`[publish] local storage: ${storageDir}`)

  // ESM import — p2p-hiverelay is type=module.
  const { HiveRelayClient } = await import('p2p-hiverelay/client')

  const client = new HiveRelayClient(storageDir, {
    // Auto-discover relays on the public HiveRelay DHT topic.
    // You can override with { bootstrap: […] } if you're on a testnet.
  })
  await client.start()

  console.log(`[publish] client started. discovering relays…`)
  // Brief wait for relay discovery
  await new Promise(r => setTimeout(r, 2500))
  if (client._relays) {
    console.log(`[publish] connected to ${client._relays.size || 0} relay(s)`)
  }

  const publishOpts = {
    appId: 'p2pbuilders-frontend',
    seed: true,
    replicas: 3,
    timeout: 30000
  }
  if (encryptionKey) {
    const b4a = require('b4a')
    publishOpts.encryptionKey = b4a.from(encryptionKey, 'hex')
    console.log(`[publish] blind mode: relay will store ciphertext only`)
  }

  const drive = await client.publish(dir, publishOpts)

  const keyHex = require('b4a').toString(drive.key, 'hex')
  console.log('')
  console.log('===========================================================')
  console.log(`  drive key:  ${keyHex}`)
  console.log(`  pear link:  pear://${keyHex}`)
  console.log(`  hyper url:  hyper://${keyHex}/index.html`)
  console.log('===========================================================')
  console.log('')
  console.log('[publish] waiting 30s for seed acceptances to propagate…')

  // Listen for seed events
  client.on('seeded', ({ key, acceptances }) => {
    if (key === keyHex) {
      console.log(`[publish] seeded on ${acceptances} relay(s)`)
    }
  })

  // Stay running so the drive is reachable. Relays may take time to accept seed
  // requests, and even after seeding the drive benefits from our local replica
  // while the network warms up. Ctrl+C to stop.
  console.log('[publish] staying online. press Ctrl+C to stop.')
  process.on('SIGINT', async () => {
    console.log('\n[publish] shutting down…')
    await client.close?.().catch(() => {})
    process.exit(0)
  })
  // Heartbeat every 10s: report current peer/relay status
  setInterval(() => {
    const peers = client.swarm?.connections?.size ?? 0
    const relays = client._relays?.size ?? 0
    console.log(`[publish] peers=${peers} relays=${relays}`)
  }, 10000).unref()
}

// Tiny argv parser so we don't need a dep.
function parseArgs (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next; i++
      } else {
        out[key] = true
      }
    }
  }
  return out
}

main().catch((err) => {
  console.error('[publish] fatal:', err.stack || err.message)
  process.exit(1)
})
