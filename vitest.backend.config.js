import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['backend/__tests__/**/*.test.js'],
    environment: 'node',
  },
})
