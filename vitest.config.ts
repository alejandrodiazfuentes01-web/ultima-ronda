import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'client/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
