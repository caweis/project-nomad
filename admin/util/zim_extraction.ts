import * as cheerio from 'cheerio'

/**
 * One section of a ZIM article: a heading, the concatenated text of the block
 * elements beneath it, and the heading level (2 for h2, 3 for h3, 4 for h4).
 */
export interface ZIMStructuredSection {
  heading: string
  text: string
  level: number
}

/**
 * The structured form of a single ZIM article.
 */
export interface ZIMStructuredContent {
  title: string
  sections: ZIMStructuredSection[]
  fullText: string
}

/**
 * Break a single ZIM article's cleaned HTML into structured sections.
 *
 * Pure: it touches nothing but cheerio and the input string — no `this`, no
 * logger, no AdonisJS, DB, or Redis — so it lives here in admin/util and is
 * unit-testable without booting the app, the same way admin/util/embed_jobs.ts
 * is. `ZIMExtractionService` keeps a thin private wrapper that delegates here.
 *
 * Behaviour locks in the upstream ZIM repair (216509a, forward-ported in
 * 8ebcadf): the walk uses `$('body').find(...)` over the whole DOM rather than
 * the direct children of <body>, so a ZIM that wraps its article in a container
 * <div> (Devdocs, Wikipedia, FreeCodeCamp, etc.) yields real sections instead
 * of zero. The zero-section fallback emits one whole-body-text section so an
 * article with text but no structural tags still contributes to the KB.
 */
export function extractStructuredContent(html: string): ZIMStructuredContent {
  const $ = cheerio.load(html)

  const title = $('h1').first().text().trim() || $('title').text().trim()

  // Extract sections with their headings and heading levels
  const sections: ZIMStructuredSection[] = []
  let currentSection = { heading: 'Introduction', content: [] as string[], level: 2 }

  // Walk the full DOM, not just direct children of <body>. Modern ZIMs
  // (Devdocs, Wikipedia, FreeCodeCamp, etc.) wrap article content in a
  // container div, which under .children() is a single non-heading element
  // and yields zero sections.
  $('body')
    .find('h2, h3, h4, p, ul, ol, dl, table')
    .each((_, element) => {
      const $el = $(element)
      const tagName = element.tagName?.toLowerCase()

      if (['h2', 'h3', 'h4'].includes(tagName)) {
        // Save current section if it has content
        if (currentSection.content.length > 0) {
          sections.push({
            heading: currentSection.heading,
            text: currentSection.content.join(' ').replace(/\s+/g, ' ').trim(),
            level: currentSection.level,
          })
        }
        // Start new section
        const level = parseInt(tagName.substring(1)) // Extract number from h2, h3, h4
        currentSection = {
          heading: $el.text().replace(/\[edit\]/gi, '').trim(),
          content: [],
          level,
        }
      } else if (['p', 'ul', 'ol', 'dl', 'table'].includes(tagName)) {
        const text = $el.text().trim()
        if (text.length > 0) {
          currentSection.content.push(text)
        }
      }
    })

  // Push the last section if it has content
  if (currentSection.content.length > 0) {
    sections.push({
      heading: currentSection.heading,
      text: currentSection.content.join(' ').replace(/\s+/g, ' ').trim(),
      level: currentSection.level,
    })
  }

  // Fallback: if the selector walk produced no sections but the body has
  // meaningful text (unusual markup, minimal headings/paragraphs), emit one
  // section with the full body text so the article still contributes to the KB.
  if (sections.length === 0) {
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
    if (bodyText.length > 0) {
      sections.push({
        heading: title || 'Content',
        text: bodyText,
        level: 2,
      })
    }
  }

  return {
    title,
    sections,
    fullText: sections.map((s) => `${s.heading}\n${s.text}`).join('\n\n'),
  }
}
