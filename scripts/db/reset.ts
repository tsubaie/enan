import { resetDatabase } from '../../src/core/db/reset';
import { closeDatabase } from '../../src/core/db/client';
await resetDatabase();
closeDatabase();
