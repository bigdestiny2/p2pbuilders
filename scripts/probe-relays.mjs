import { HiveRelayClient } from 'p2p-hiverelay/client'
import b4a from 'b4a'
import hypercoreId from 'hypercore-id-encoding'

const client = new HiveRelayClient('./.hiverelay-probe')
await client.start()
await new Promise(r => setTimeout(r, 4000))

const k = hypercoreId.decode('gopfpwat99tcuaakasfnftrds3j6t7srdmi3qidbhm9xeizt1a5y')
const acceptances = await client.seed(k, { replicas: 8, timeout: 25000 })
console.log(`\nseeded on ${acceptances.length} relay(s):\n`)
for (const a of acceptances) {
  const pk = b4a.toString(a.relayPubkey, 'hex')
  const gb = (a.availableStorageBytes / 1024 / 1024 / 1024).toFixed(1)
  console.log(`  ${a.region.padEnd(5)} ${pk.slice(0, 16)}…  (${gb} GB free)`)
}
await client.close?.()
process.exit(0)
