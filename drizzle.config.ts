import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'sqlite',
  schema: ['./src/core/db/system-schema.ts', './src/modules/*/schema/db.ts'],
  out: './drizzle',
});
