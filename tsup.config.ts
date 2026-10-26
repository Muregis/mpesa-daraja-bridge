import { defineConfig } from 'tsup'

export default defineConfig([
  // ---------------------------------------------------------------------------
  // Library: the importable package (mpesa-stk and mpesa-stk/server)
  // ---------------------------------------------------------------------------
  {
    entry: {
      index:              'src/index.ts',
      'adapters/memory':  'src/adapters/memory.ts',
      'adapters/postgres':'src/adapters/postgres.ts',
      'adapters/sqlite':  'src/adapters/sqlite.ts',
      'server/index':     'src/server/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['pg', 'better-sqlite3', 'hono', '@hono/node-server'],
  },

  // ---------------------------------------------------------------------------
  // Binary: the standalone relay server (npx mpesa-stk-relay)
  // ---------------------------------------------------------------------------
  {
    entry: {
      'bin/serve': 'bin/serve.ts',
    },
    format: ['cjs'],
    dts: false,
    sourcemap: false,
    // Bundle everything into the binary so it runs with no extra installs
    noExternal: ['hono', '@hono/node-server'],
    external: ['pg'],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
])
