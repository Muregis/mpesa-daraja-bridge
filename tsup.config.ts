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
      'bridge/index':     'src/bridge/server.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['pg', 'better-sqlite3', 'hono', '@hono/node-server'],
  },

  // ---------------------------------------------------------------------------
  // Binaries: the standalone relay server and the cashier payment bridge
  // ---------------------------------------------------------------------------
  {
    entry: {
      'bin/serve':  'bin/serve.ts',
      'bin/bridge': 'bin/bridge.ts',
    },
    format: ['cjs'],
    dts: false,
    sourcemap: false,
    noExternal: ['hono', '@hono/node-server'],
    external: ['pg', 'better-sqlite3'],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
])
