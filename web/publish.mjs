#!/usr/bin/env node
/**
 * publish.mjs — publish the p2pbuilders browser site to HiveRelay (and the
 * PearBrowser catalog), or host it locally for testing.
 *
 *   node publish.mjs --local   # create the drive + host it locally for PearBrowser
 *                              # (no relay seeding, not in the catalog) — keeps running
 *   node publish.mjs           # publish + seed to the live fleet + register in catalog
 *   KEEP=1 node publish.mjs     # stay online so relays fully anchor the drive
 *
 * The non-local form is OUTWARD-FACING (public network). Run deliberately.
 */
import { HiveRelayClient } from '/Users/localllm/Projects/pear-ecosystem/00-core/hiverelay/packages/client/index.js'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const relayCount = (s) => (s && (s.relays ? s.relays.length : s.relayCount)) || 0
const LOCAL = process.argv.includes('--local')

const SITE_FILES = [
  'index.html', 'styles.css', 'icon.svg',
  'js/app.js', 'js/canon.js', 'js/crypto.js', 'js/data.js', 'js/gossip.js',
  'js/identity.js', 'js/markdown.js', 'js/model.js', 'js/pow.js', 'js/prefs.js',
  'js/ranking.js', 'js/reputation.js', 'js/sync.js', 'js/util.js', 'js/verify.js'
]

async function main () {
  const manifestPath = join(__dir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

  const client = new HiveRelayClient({ storage: join(__dir, LOCAL ? '.hiverelay-local' : '.hiverelay-seed') })
  await client.start()
  await sleep(LOCAL ? 1500 : 5000)
  console.log('[p2pb] relays connected:', relayCount(client.getStatus && client.getStatus()))

  const files = SITE_FILES.map((p) => ({ path: '/' + p, content: readFileSync(join(__dir, p)) }))
  console.log('[p2pb] publishing site drive (' + files.length + ' files)…')
  const drive = await client.publish(files, { appId: 'p2pbuilders-web', seed: !LOCAL, replicas: 4, ttlDays: 365 })
  const driveKey = drive.key.toString('hex')
  console.log('[p2pb] site drive key:', driveKey)

  if (LOCAL) {
    console.log('\n[p2pb] ── LOCAL TEST (not seeded to relays, not in catalog) ──')
    console.log('[p2pb] Open this in PearBrowser:\n\n    hyper://' + driveKey + '/\n')
    console.log('[p2pb] Keep THIS process running so PearBrowser can replicate the drive. (Ctrl-C to stop.)')
    setInterval(() => {}, 1 << 30)
    return
  }

  manifest.driveKey = driveKey
  manifest.url = 'hyper://' + driveKey + '/'
  manifest.homepage = manifest.url
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log('[p2pb] manifest.json updated with driveKey')

  console.log('[p2pb] publishing manifest + seeding for catalog…')
  await client.publish([{ path: '/manifest.json', content: JSON.stringify(manifest, null, 2) }],
    { appId: 'p2pbuilders-web-manifest', seed: true, replicas: 4, ttlDays: 365 })
  try {
    const res = await client.seed(Buffer.from(driveKey, 'hex'), { replicas: 4, ttlDays: 365, timeout: 30000 })
    console.log('[p2pb] seed acceptances:', (res || []).length)
  } catch (err) { console.log('[p2pb] seed note:', err.message) }

  console.log('\n[p2pb] Live at:  hyper://' + driveKey + '/\n')
  if (process.env.KEEP === '1') { console.log('[p2pb] staying alive so relays anchor (Ctrl-C to stop)…'); setInterval(() => {}, 1 << 30); return }
  await sleep(20000)
  try { if (client.destroy) await client.destroy() } catch {}
  process.exit(0)
}

main().catch((err) => { console.error('[p2pb] failed:', err.stack || err.message); process.exit(1) })
