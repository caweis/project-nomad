import { test } from '@japa/runner'
import { extractStructuredContent } from '../../util/zim_extraction.js'

test.group('extractStructuredContent — container-div ZIM', () => {
  // The bug 8ebcadf fixed (upstream 216509a): article content wrapped in a
  // container <div> is a single non-heading child of <body>, so the old
  // $('body').children() walk matched nothing and the article silently embedded
  // zero chunks while reporting success. The $('body').find(...) walk descends
  // into the wrapper and recovers the real sections.
  const containerHtml = `
    <html><body>
      <div class="mw-parser-output">
        <h2>Installation</h2>
        <p>Run the installer and follow the prompts.</p>
        <h2>Configuration</h2>
        <p>Edit the config file to taste.</p>
      </div>
    </body></html>`

  test('recovers one section per heading from div-wrapped content', ({ assert }) => {
    const { sections } = extractStructuredContent(containerHtml)
    // .children() yielded 0 here (then a single fallback section). The full-DOM
    // walk yields one section per h2.
    assert.equal(sections.length, 2)
    assert.deepEqual(
      sections.map((s) => s.heading),
      ['Installation', 'Configuration']
    )
    assert.equal(sections[0].text, 'Run the installer and follow the prompts.')
    assert.equal(sections[1].text, 'Edit the config file to taste.')
  })

  test('does not collapse to a single whole-body fallback section', ({ assert }) => {
    // Guards the regression directly: collapsing both headings into one section
    // is exactly the pre-fix .children() behaviour.
    const { sections } = extractStructuredContent(containerHtml)
    assert.notEqual(sections.length, 1)
  })
})

test.group('extractStructuredContent — zero-section fallback', () => {
  test('emits one whole-body section when there are no structural tags', ({ assert }) => {
    const html = `<html><body>Loose body text with no headings or paragraphs.</body></html>`
    const { sections } = extractStructuredContent(html)
    assert.equal(sections.length, 1)
    assert.equal(sections[0].heading, 'Content')
    assert.equal(sections[0].level, 2)
    assert.equal(sections[0].text, 'Loose body text with no headings or paragraphs.')
  })

  test('uses the document title as the fallback heading when present', ({ assert }) => {
    const html = `<html><head><title>Readme</title></head><body>Bare text, no structure.</body></html>`
    const { sections } = extractStructuredContent(html)
    assert.equal(sections.length, 1)
    assert.equal(sections[0].heading, 'Readme')
  })

  test('emits no sections when the body is empty', ({ assert }) => {
    const { sections } = extractStructuredContent(`<html><body></body></html>`)
    assert.equal(sections.length, 0)
  })
})

test.group('extractStructuredContent — normal h2/h3 document', () => {
  const html = `
    <html><head><title>Doc Title</title></head><body>
      <h1>Main Heading</h1>
      <p>Intro paragraph that precedes any h2.</p>
      <h2>Section One</h2>
      <p>Content for section one.</p>
      <h3>Subsection</h3>
      <p>Sub content.</p>
    </body></html>`

  test('extracts the title from the first h1', ({ assert }) => {
    assert.equal(extractStructuredContent(html).title, 'Main Heading')
  })

  test('groups content into the expected sections with heading levels', ({ assert }) => {
    const { sections } = extractStructuredContent(html)
    assert.deepEqual(
      sections.map((s) => ({ heading: s.heading, level: s.level })),
      [
        { heading: 'Introduction', level: 2 },
        { heading: 'Section One', level: 2 },
        { heading: 'Subsection', level: 3 },
      ]
    )
  })

  test('places pre-heading content under the default Introduction section', ({ assert }) => {
    const { sections } = extractStructuredContent(html)
    assert.equal(sections[0].text, 'Intro paragraph that precedes any h2.')
  })

  test('strips [edit] affordances from headings', ({ assert }) => {
    const edited = `<html><body><h2>History[edit]</h2><p>Some history.</p></body></html>`
    const { sections } = extractStructuredContent(edited)
    assert.equal(sections[0].heading, 'History')
  })

  test('fullText joins every section as heading then text', ({ assert }) => {
    const { fullText } = extractStructuredContent(html)
    assert.equal(
      fullText,
      'Introduction\nIntro paragraph that precedes any h2.\n\n' +
        'Section One\nContent for section one.\n\n' +
        'Subsection\nSub content.'
    )
  })
})
