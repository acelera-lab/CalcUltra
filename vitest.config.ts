import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    env: {
      DB_PATH: './data/test.sqlite',
      SESSION_SECRET: 'test-secret-123',
      APP_URL: 'http://localhost:3016',
      PORT: '3016',
      MP_ACCESS_TOKEN: '',
      OPENROUTER_KEY: '',
    },
    setupFiles: ['./tests/setup.ts'],
  },
});
