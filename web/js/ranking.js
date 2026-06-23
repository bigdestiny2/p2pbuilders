// ranking.js — Hacker-News-style ranking. Posts rank by reputation-weighted
// score decayed by age; comments rank by weighted score. Pure functions over
// records carrying { createdAt, score } where `score` is the weighted score the
// data layer computed.

// HN hot: gravity 1.8, mild score curve. Newer + higher-scored ranks higher.
export function hotScore (score, createdAt, now = Date.now()) {
  const hours = Math.max(0, (now - createdAt) / 3600000)
  return Math.pow(Math.max(0, score) + 1, 0.8) / Math.pow(hours + 2, 1.8)
}

export const POST_SORTS = ['hot', 'new', 'top']
export const COMMENT_SORTS = ['best', 'new', 'top']

export function sortPosts (posts, sort = 'hot', now = Date.now()) {
  const cmp = sort === 'new'
    ? (a, b) => b.createdAt - a.createdAt
    : sort === 'top'
      ? (a, b) => (b.score - a.score) || (b.createdAt - a.createdAt)
      : (a, b) => hotScore(b.score, b.createdAt, now) - hotScore(a.score, a.createdAt, now)
  return posts.slice().sort((a, b) => {
    const sa = a.stickied ? 1 : 0, sb = b.stickied ? 1 : 0
    if (sa !== sb) return sb - sa
    return cmp(a, b)
  })
}

export function sortComments (nodes, sort = 'best', now = Date.now()) {
  const cmp = sort === 'new'
    ? (a, b) => b.createdAt - a.createdAt
    : (a, b) => (b.score - a.score) || (b.createdAt - a.createdAt) // best/top by weighted score
  return nodes.slice().sort(cmp)
}
