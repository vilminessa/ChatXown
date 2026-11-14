// Bundles the ESM-only youtubei.js (and its dependencies) into a single ESM file
// that can be shipped as an extraResource and imported outside app.asar.
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('out', { recursive: true })

await build({
  stdin: {
    contents: "export * from 'youtubei.js'",
    resolveDir: process.cwd(),
    sourcefile: 'youtube-entry.mjs',
    loader: 'js'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'out/youtube.mjs',
  logLevel: 'warning'
})

console.log('✓ bundled out/youtube.mjs')
