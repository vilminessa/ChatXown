type YouTubeModule = typeof import('youtubei.js')

let libPromise: Promise<YouTubeModule> | null = null
let clientPromise: Promise<any> | null = null

/**
 * youtubei.js is ESM-only while the Electron main process is bundled as CommonJS.
 * A native dynamic import (hidden from the bundler) loads it correctly.
 */
export function loadYouTubeLib(): Promise<YouTubeModule> {
  if (!libPromise) {
    const nativeImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string
    ) => Promise<YouTubeModule>
    libPromise = nativeImport('youtubei.js')
  }
  return libPromise
}

export async function getInnertube(): Promise<any> {
  if (!clientPromise) {
    clientPromise = loadYouTubeLib()
      .then(async (lib) => {
        lib.Log.setLevel(lib.Log.Level.ERROR)
        lib.Parser.setParserErrorHandler(() => {
          /* Unknown/new YouTube node types are non-fatal; keep the chat running. */
        })
        return lib.Innertube.create({ retrieve_player: false })
      })
      .catch((error) => {
        clientPromise = null
        throw error
      })
  }
  return clientPromise
}
