import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
  },
});
