/**
 * Load the three stream-json factories used to read the `results` array from
 * a drug-label export. Keep the interop check before the ZIP callback: a bad
 * import must reject the job instead of leaving its stream promise pending.
 */
export async function loadDrugJsonFactories() {
  // Version 3 exports ESM factories. Its bare factories are functions for
  // stream-chain; the job's `.pipe()` chain needs the Node Duplex wrappers.
  const jsonModule = await import('stream-json')
  const pickModule = await import('stream-json/filters/pick.js')
  const arrayModule = await import('stream-json/streamers/stream-array.js')
  const parser = jsonModule.parser.asStream
  const pick = pickModule.pick.asStream
  const streamArray = arrayModule.streamArray.asStream

  if (
    typeof parser !== 'function' ||
    typeof pick !== 'function' ||
    typeof streamArray !== 'function'
  ) {
    throw new Error(
      'stream-json factory imports did not resolve to functions ' +
        `(parser=${typeof parser}, pick=${typeof pick}, streamArray=${typeof streamArray})`
    )
  }

  return { parser, pick, streamArray }
}
