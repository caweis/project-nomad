import * as cheerio from 'cheerio'
import { NON_CONTENT_HEADING_PATTERNS } from '../constants/zim_extraction.js'

/**
 * True when a section heading is low-signal boilerplate (See also / References /
 * External links / …). Sections under these are reference apparatus, not article
 * content, and shouldn't reach embeddings. Ported from upstream #1044.
 */
function isNonContentHeading(heading: string): boolean {
  return NON_CONTENT_HEADING_PATTERNS.some((pattern) => pattern.test(heading))
}

/**
 * Render an HTML <table> into delimited text. cheerio's `.text()` concatenates
 * every cell with no separators ("AgeDoseAdult500mg" word-salad), which is
 * unsearchable and pollutes embeddings. Join cells with " | " and rows with
 * newlines. Ported from upstream #1044.
 */
function tableToText($: cheerio.CheerioAPI, table: any): string {
  const rows: string[] = []
  $(table)
    .find('tr')
    .each((_, tr) => {
      const cells = $(tr)
        .find('th, td')
        .map((__, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter((cell) => cell.length > 0)
      if (cells.length > 0) {
        rows.push(cells.join(' | '))
      }
    })
  return rows.join('\n')
}

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
  let currentSection = { heading: 'Introduction', content: [] as string[], level: 2, skip: false }
  let sawAnyElement = false

  // Flush the current section unless it's a non-content one (References, See
  // also, …) or empty. #1044.
  const flush = () => {
    if (!currentSection.skip && currentSection.content.length > 0) {
      sections.push({
        heading: currentSection.heading,
        text: currentSection.content.join(' ').replace(/\s+/g, ' ').trim(),
        level: currentSection.level,
      })
    }
  }

  // Walk the full DOM, not just direct children of <body>. Modern ZIMs
  // (Devdocs, Wikipedia, FreeCodeCamp, etc.) wrap article content in a
  // container div, which under .children() is a single non-heading element
  // and yields zero sections.
  $('body')
    .find('h2, h3, h4, p, ul, ol, dl, table')
    .each((_, element) => {
      sawAnyElement = true
      const $el = $(element)
      const tagName = element.tagName?.toLowerCase()

      if (['h2', 'h3', 'h4'].includes(tagName)) {
        flush()
        // Start new section; skip it entirely if its heading is boilerplate.
        const level = parseInt(tagName.substring(1)) // Extract number from h2, h3, h4
        const heading = $el.text().replace(/\[edit\]/gi, '').trim()
        currentSection = { heading, content: [], level, skip: isNonContentHeading(heading) }
      } else if (['p', 'ul', 'ol', 'dl', 'table'].includes(tagName)) {
        if (currentSection.skip) return
        // Tables get delimited rendering so cells stay searchable; #1044.
        const text = tagName === 'table' ? tableToText($, element) : $el.text().trim()
        if (text.length > 0) {
          currentSection.content.push(text)
        }
      }
    })

  // Push the last section (skip-aware).
  flush()

  // Fallback: emit one whole-body section ONLY when the walk matched no
  // structural elements at all (unusual markup). Deliberately NOT when we found
  // sections but dropped them all as non-content — an all-references article
  // should contribute nothing, not have its reference apparatus re-included
  // whole (#1044, Maxim 9).
  if (sections.length === 0 && !sawAnyElement) {
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
