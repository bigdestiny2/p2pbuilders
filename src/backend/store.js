'use strict'

const { fs, os, path } = require('./_rt')
const Corestore = require('corestore')
const { USER_CORE_NAME, loadOrCreatePrimaryKey, generatePrimaryKey } = require('./identity')

function openStore ({ storage, primaryKey } = {}) {
  if (!storage) throw new Error('storage required')
  // unsafe:true acknowledges we intentionally provide the primary key — it is our identity root.
  return new Corestore(storage, primaryKey ? { primaryKey, unsafe: true } : {})
}

async function openUserCore (store) {
  const core = store.get({ name: USER_CORE_NAME })
  await core.ready()
  return core
}

// disk-backed node. We let Corestore manage its own seed file at `dir/` —
// trying to pass our own primaryKey on top of an existing corestore causes
// "Another corestore is stored here" errors in v7. `store.primaryKey` is
// readable after `.ready()` if anything needs it.
async function openDiskNode (dir) {
  fs.mkdirSync(dir, { recursive: true })
  const store = new Corestore(dir)
  await store.ready()
  const core = await openUserCore(store)
  return { store, core, primaryKey: store.primaryKey, dir }
}

// ephemeral node: fresh tmp dir, cleaned up on close. good for tests.
async function openTempNode ({ primaryKey } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2pbuilders-'))
  const pk = primaryKey || generatePrimaryKey()
  // persist the key so the tmp dir is a valid node on its own
  fs.writeFileSync(path.join(dir, '.p2pbuilders.key'), pk, { mode: 0o600 })
  const store = openStore({ storage: dir, primaryKey: pk })
  const core = await openUserCore(store)
  return {
    store,
    core,
    primaryKey: pk,
    dir,
    cleanup () { fs.rmSync(dir, { recursive: true, force: true }) }
  }
}

module.exports = { openStore, openUserCore, openDiskNode, openTempNode }
