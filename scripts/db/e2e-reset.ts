import { resetDisposableDatabase } from '../../src/core/db/reset';
import { closeDatabase } from '../../src/core/db/client';
// Every browser run starts from an empty workspace, so records earlier runs left behind can never
// change what a test sees. Only a `_test.db` file is wiped (resetDisposableDatabase).
const { name, reset } = await resetDisposableDatabase();
process.stdout.write(`${reset ? 'reset' : 'kept'} ${name}\n`);
closeDatabase();
