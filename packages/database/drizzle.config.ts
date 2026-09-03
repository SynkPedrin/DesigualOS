import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(currentDir, '../../.env') });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: '../../database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
