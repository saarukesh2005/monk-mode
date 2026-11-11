import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@monk/shared-types': pkg('shared-types'),
      '@monk/shared-core': pkg('shared-core'),
      '@monk/analytics': pkg('analytics'),
      '@monk/validation': pkg('validation'),
      '@monk/design-system': pkg('design-system'),
      '@monk/database': pkg('database'),
    },
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'extensions/shared/test/**/*.test.ts',
      'apps/desktop/tests/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    environment: 'node',
  },
});
