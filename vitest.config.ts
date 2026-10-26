import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    // Allow TypeScript path resolution with .js extensions (Node ESM)
    conditions: ['import', 'node'],
  },
})
