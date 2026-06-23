// model.js — the p2pbuilders data model (HN-shaped) expressed for the gossip
// engine's generic reducer: an op { type, data } is stored at Hyperbee key
// `type!data.id` (last-write-wins). Scope + identity are encoded into data.id so
// prefix scans give cheap feeds, threads, vote tallies, and social-graph reads.
//
//   board      board!<name>                          (sticky: first creator owns the name)
//   post       post!<board>!<cid>
//   comment    comment!<postCid>!<cid>                (parentCid links the thread)
//   vote       vote!<targetCid>!<authorPub>           (one per voter -> LWW)
//   profile    profile!<authorPub>
//   follow     follow!<authorPub>!<targetPub>         (published social graph)
//   block      block!<authorPub>!<targetPub>          (public:true => advertised)
//   blocklist  blocklist!<authorPub>                  (subscribable curated list)

export const TYPE = {
  BOARD: 'board', POST: 'post', COMMENT: 'comment', VOTE: 'vote',
  PROFILE: 'profile', FOLLOW: 'follow', BLOCK: 'block', BLOCKLIST: 'blocklist'
}

export const DEFAULT_BOARD = 'front'

export const keys = {
  board: (name) => `${TYPE.BOARD}!${name}`,
  boardPrefix: () => `${TYPE.BOARD}!`,
  post: (board, cid) => `${TYPE.POST}!${board}!${cid}`,
  postsIn: (board) => `${TYPE.POST}!${board}!`,
  comment: (postCid, cid) => `${TYPE.COMMENT}!${postCid}!${cid}`,
  commentsOn: (postCid) => `${TYPE.COMMENT}!${postCid}!`,
  vote: (targetCid, author) => `${TYPE.VOTE}!${targetCid}!${author}`,
  votesFor: (targetCid) => `${TYPE.VOTE}!${targetCid}!`,
  voteAll: () => `${TYPE.VOTE}!`,
  profile: (author) => `${TYPE.PROFILE}!${author}`,
  follow: (author, target) => `${TYPE.FOLLOW}!${author}!${target}`,
  followsBy: (author) => `${TYPE.FOLLOW}!${author}!`,
  block: (author, target) => `${TYPE.BLOCK}!${author}!${target}`,
  blocksBy: (author) => `${TYPE.BLOCK}!${author}!`,
  blocklist: (author) => `${TYPE.BLOCKLIST}!${author}`,
  blocklistPrefix: () => `${TYPE.BLOCKLIST}!`
}

// data.id builders (the part after `type!` — determines the storage key).
export const id = {
  board: (name) => name,
  post: (board, cid) => `${board}!${cid}`,
  comment: (postCid, cid) => `${postCid}!${cid}`,
  vote: (targetCid, author) => `${targetCid}!${author}`,
  profile: (author) => author,
  follow: (author, target) => `${author}!${target}`,
  block: (author, target) => `${author}!${target}`,
  blocklist: (author) => author
}

// Board name rules: lowercase letters/digits/underscore, 2–24 chars.
export function isValidBoard (s) { return typeof s === 'string' && /^[a-z0-9_]{2,24}$/.test(s) }
export function normalizeBoard (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) }

// Build a threaded comment tree from a flat list (parentCid -> children).
// Orphans (missing parent) attach at root so nothing is lost.
export function buildCommentTree (comments) {
  const byCid = new Map()
  for (const c of comments) byCid.set(c.cid, { ...c, children: [] })
  const roots = []
  for (const node of byCid.values()) {
    const parent = node.parentCid && byCid.get(node.parentCid)
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  return { roots, index: byCid }
}

export function sortCommentTree (roots, sorter) {
  const sorted = sorter(roots)
  for (const n of sorted) if (n.children.length) n.children = sortCommentTree(n.children, sorter)
  return sorted
}

export function countDescendants (node) {
  let n = 0
  for (const c of node.children) n += 1 + countDescendants(c)
  return n
}

// Resolve the effective set of blocked pubkeys for the local viewer:
//   localBlocks   — pubkeys you blocked on this device
//   subscribed    — authors whose published blocklists you subscribe to
//   blocklistRecs — all `blocklist` records seen (author -> { list:[pubkey] })
export function resolveBlocked (localBlocks, subscribed, blocklistRecs) {
  const set = new Set(localBlocks || [])
  const subs = new Set(subscribed || [])
  for (const rec of blocklistRecs || []) {
    if (!rec || !subs.has(rec.author)) continue
    for (const k of rec.list || []) set.add(k)
  }
  return set
}
