import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: {
      DATABASE_URL: 'postgresql://idest:idest@localhost:5432/idest_clerk_test',
    },
    globalSetup: ['./test/setup-e2e.ts'],
  },
});
