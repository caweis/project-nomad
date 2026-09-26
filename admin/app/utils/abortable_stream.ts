/**
 * Tie a streamed reply's lifetime to the reader who asked for it.
 *
 * ollama-js hands back an AbortableAsyncIterator for a streamed chat. Reading
 * it pulls tokens over an open HTTP request, and the model keeps generating for
 * as long as that request stays open, whether or not anyone is left to read the
 * answer. With Ollama's default of one request at a time, an answer nobody is
 * reading is the next question kept waiting (upstream #1065).
 *
 * A reader can leave two ways, and both have to close the request:
 *   - the signal fires, because the browser went away;
 *   - the consumer stops iterating early, by break, throw or return.
 *
 * Import-free so it runs under bare `node --experimental-strip-types`, the same
 * convention as think_stream.ts.
 */

/** Anything that can be read as a stream and told to stop producing. */
export type AbortableSource<T> = AsyncIterable<T> & { abort(): void }

export async function* abortWith<T>(
  source: AbortableSource<T>,
  signal?: AbortSignal
): AsyncGenerator<T> {
  if (signal?.aborted) {
    // Gone before the first token, as when the reader leaves while the model
    // is still loading: close the request and do not start reading it.
    source.abort()
    return
  }
  const onAbort = () => source.abort()
  signal?.addEventListener('abort', onAbort, { once: true })

  let finished = false
  try {
    for await (const item of source) {
      yield item
    }
    finished = true
  } finally {
    signal?.removeEventListener('abort', onAbort)
    // Only reached unfinished by leaving early, when the source is still open
    // and still generating. Aborting a source that already failed is a no-op.
    if (!finished) source.abort()
  }
}
