# smaltdb Node

<a href="https://smaltworks.dev/stability"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/stenhoor/smalt-brand/main/badges/work-in-progress-on-dark.svg"><img alt="Work in progress. Come build with us." src="https://raw.githubusercontent.com/stenhoor/smalt-brand/main/badges/work-in-progress.svg" height="56"></picture></a>

[Documentation](https://smaltdb.dev) · [smaltworks.dev](https://smaltworks.dev/products/plugins)

Files on disk for [smaltdb](https://github.com/stenhoor/smaltdb) in Node.js. In a browser, smaltdb keeps a database in
the browser's private storage (OPFS); in Node, this plugin keeps it in a file. No dependencies.

```sh
npm install --save-exact @smaltworks/smaltdb @smaltworks/smaltql @smaltworks/smaltdb-node   # not on npm yet
```

```ts
import { Database } from 'smaltdb/engine';
import { registerLanguage } from 'smaltdb/language';
import { sqlLanguage } from '@smaltworks/smaltql';
import { NodeVfs } from '@smaltworks/smaltdb-node';

registerLanguage(sqlLanguage);
const db = await Database.open(new NodeVfs({ root: 'data' }), 'orders.db');
db.exec('CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, region TEXT)');
db.close();
```

- **Files:** `data/orders.db`, its log `orders.db-wal`, and a scratch file for large sorts, `orders.db-spill`. Paths
  are relative to `root` (default: the working directory); folders are created as needed.
- **One writer:** while a database is open, a lock file beside it (`orders.db.lock`) holds the process id. Opening it
  again, from this process or another, fails with `SMALT_BUSY` until it is closed. A lock left by a process that was
  killed is taken over.
- **Durable:** a commit is on disk (fsync) when smaltdb returns. Rows committed before a crash are there when the
  database opens again.

Not yet for production or data you can't recreate. Try it, break it, tell us. MIT licence.

## Development

```sh
npm ci && npm run deps   # deps: the pinned smaltdb and smaltql builds from packed.json (until 0.9.0 is on npm)
npm run check            # type-check and test
```

See [CLAUDE.md](CLAUDE.md) for how the pins work.

<a href="https://smaltworks.dev"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/stenhoor/smalt-brand/main/badges/a-smaltworks-project-on-dark.svg"><img alt="A smaltworks project" src="https://raw.githubusercontent.com/stenhoor/smalt-brand/main/badges/a-smaltworks-project.svg" height="28"></picture></a>

MIT License.
