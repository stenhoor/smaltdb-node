// Run by test/database.test.ts in its own process: commits 100 rows to <dir>/shop.db, then is killed (SIGKILL) with
// the database still open.
import { Database } from 'smaltdb/engine';
import { registerLanguage } from 'smaltdb/language';
import { sqlLanguage } from '@smaltworks/smaltql';
import { NodeVfs } from '../../src/index.ts';

registerLanguage(sqlLanguage);
const db = await Database.open(new NodeVfs({ root: process.argv[2] }), 'shop.db');
db.exec('CREATE TABLE orders(id INTEGER PRIMARY KEY, qty INTEGER)');
for (let i = 1; i <= 100; i++) db.run('INSERT INTO orders VALUES (?, ?)', [i, i]);
process.stdout.write('committed\n', () => process.kill(process.pid, 'SIGKILL'));
