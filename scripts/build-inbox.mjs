import { build } from 'vite'
import { fileURLToPath } from 'node:url'

await build({
  configFile: false,
  root: fileURLToPath(new URL('../', import.meta.url)),
  logLevel: 'warn',
  build: {
    lib: { entry: fileURLToPath(new URL('../src/lib/inboxRuntime.ts', import.meta.url)), formats: ['es'], fileName: () => 'inbox-core.mjs' },
    outDir: 'runtime', emptyOutDir: false, minify: false,
    sourcemap: false,
  },
})
