import { pathToFileURL } from 'node:url'

export function hasPassingCaseSummary(output) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '')
  const match = clean.match(/^Tests\s+(\d+) passed \((\d+)\)\s*$/m)
  return Boolean(match && Number(match[1]) > 0 && match[1] === match[2] && /\bPASSED\b/.test(clean))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let output = ''
  for await (const chunk of process.stdin) output += chunk
  if (!hasPassingCaseSummary(output)) {
    console.error('Adonis ran no passing test summary; test gate failed')
    process.exitCode = 1
  }
}
