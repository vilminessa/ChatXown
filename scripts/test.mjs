// Bundles the TS tests with esbuild and runs them in Node.
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

mkdirSync('.tmp', { recursive: true })

await build({
  entryPoints: ['tests/parser.test.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: '.tmp/parser.test.mjs',
  logLevel: 'warning'
})

const result = spawnSync(process.execPath, ['.tmp/parser.test.mjs'], { stdio: 'inherit' })
process.exit(result.status ?? 1)
