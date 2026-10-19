import { migrateDatabase } from '../../src/core/db/migrate';
import { closeDatabase } from '../../src/core/db/client';
await migrateDatabase();
closeDatabase();
