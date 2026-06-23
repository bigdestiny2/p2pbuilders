// prefs.js — per-device, per-identity local state that doesn't belong in the
// shared P2P log: which curators' blocklists you subscribe to, posts you've
// hidden, your default sort, and your default board. Keyed by the active pubkey.

export class Prefs {
  constructor (storage, pubkey) {
    this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : memShim())
    this.pub = pubkey || 'anon'
    this.key = 'p2pb:prefs:' + this.pub
    this.data = this._load()
  }

  _load () {
    try {
      const d = JSON.parse(this.storage.getItem(this.key) || '{}')
      return Object.assign({ blocklistSubs: [], hidden: [], sort: 'hot', board: 'front', seenWelcome: false }, d)
    } catch {
      return { blocklistSubs: [], hidden: [], sort: 'hot', board: 'front', seenWelcome: false }
    }
  }
  _save () { this.storage.setItem(this.key, JSON.stringify(this.data)) }

  // Subscribed blocklists (curator pubkeys)
  isSubscribedBlocklist (author) { return this.data.blocklistSubs.includes(author) }
  toggleBlocklist (author) {
    if (this.isSubscribedBlocklist(author)) this.data.blocklistSubs = this.data.blocklistSubs.filter(a => a !== author)
    else this.data.blocklistSubs.push(author)
    this._save(); return this.isSubscribedBlocklist(author)
  }
  blocklistSubs () { return this.data.blocklistSubs.slice() }

  // Hidden posts (ref = "board/cid")
  isHidden (ref) { return this.data.hidden.includes(ref) }
  toggleHidden (ref) {
    if (this.isHidden(ref)) this.data.hidden = this.data.hidden.filter(r => r !== ref)
    else this.data.hidden.unshift(ref)
    this._save(); return this.isHidden(ref)
  }

  setSort (s) { this.data.sort = s; this._save() }
  get sort () { return this.data.sort }
  markWelcomeSeen () { this.data.seenWelcome = true; this._save() }
  get seenWelcome () { return this.data.seenWelcome }
}

function memShim () {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
