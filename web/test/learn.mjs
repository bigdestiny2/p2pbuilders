// learn.mjs — validates the Learn hub content: schema, unique ids, section
// integrity, markdown rendering, internal links, and table support.
// Run: node test/learn.mjs

import assert from 'node:assert'
import { SECTIONS, LESSONS, lessonById, lessonsBySection, numberedLessons } from '../js/learn-content.js'
import { renderMarkdown } from '../js/markdown.js'

let passed = 0
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m) }

console.log('— learn content —')
ok(SECTIONS.length >= 6, 'has all six content sections')
ok(LESSONS.length >= 20, 'has a substantial lesson library (' + LESSONS.length + ' lessons)')

const sectionIds = new Set(SECTIONS.map(s => s.id))
ok(sectionIds.size === SECTIONS.length, 'section ids are unique')
for (const want of ['fieldmanual', 'handbook', 'holepunch', 'rooms', 'eco', 'builds', 'patterns']) {
  ok(sectionIds.has(want), 'section "' + want + '" exists')
}
ok(LESSONS.filter(l => l.section === 'fieldmanual').length === 8, 'field manual has syllabus + 7 days')

const ids = new Set()
for (const l of LESSONS) {
  assert.ok(!ids.has(l.id), 'duplicate lesson id: ' + l.id)
  ids.add(l.id)
  assert.ok(/^[a-z0-9-]+$/.test(l.id), 'lesson id is url-safe: ' + l.id)
  assert.ok(sectionIds.has(l.section), l.id + ' references a real section')
  assert.ok(l.title && l.title.trim(), l.id + ' has a title')
  assert.ok(l.summary && l.summary.trim(), l.id + ' has a summary')
  assert.ok(Number.isFinite(l.minutes) && l.minutes > 0, l.id + ' has a read time')
  assert.ok(l.body && l.body.trim().length > 200, l.id + ' has a substantial body')
}
ok(true, 'every lesson has id/section/title/summary/minutes/body (' + ids.size + ' checked)')

const perSection = lessonsBySection()
ok(perSection.every(g => g.lessons.length >= 1), 'no section is empty')
ok(numberedLessons().length === LESSONS.length, 'flat numbering covers every lesson exactly once')
ok(lessonById('handbook-intro') !== null && lessonById('nope') === null, 'lessonById finds real ids, rejects unknown')

console.log('\n— markdown rendering —')
for (const l of LESSONS) {
  const html = renderMarkdown(l.body)
  assert.ok(html.includes('<h1>'), l.id + ' renders an <h1>')
  assert.ok(!/<script/i.test(html), l.id + ' emits no script tags')
}
ok(true, 'every lesson body renders markdown with a top heading and no scripts')

let links = 0
for (const l of LESSONS) {
  for (const m of l.body.matchAll(/\(#\/learn\/([a-z0-9-]+)\)/g)) {
    links++
    assert.ok(ids.has(m[1]), l.id + ' links to existing lesson "' + m[1] + '"')
  }
}
ok(links > 10, 'internal cross-links all resolve (' + links + ' links checked)')

const t = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
ok(t.includes('<table>') && t.includes('<th>a</th>') && t.includes('<td>2</td>'), 'markdown tables render (used by lesson bodies)')

console.log('\n✅ all ' + passed + ' learn checks passed\n')
