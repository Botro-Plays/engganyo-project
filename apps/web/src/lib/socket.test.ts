// Lifecycle tests for lib/socket.ts run under node:test + tsx (no DOM
// needed - the module only touches process.env). The importer is
// injectable so tests control exactly when the lazy socket.io-client
// module resolves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectSocket, disconnectSocket, getSocket } from './socket';

type FakeSocket = {
  connected: boolean;
  disconnect: () => void;
  on: () => void;
  off: () => void;
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeIo(created: Array<{ url: string; auth: { token: string } }>) {
  return (url: string, opts: { auth: { token: string } }): FakeSocket => {
    created.push({ url, auth: opts.auth });
    return {
      connected: true,
      disconnect() {
        this.connected = false;
      },
      on() {},
      off() {},
    };
  };
}

function ioModule(created: Array<{ url: string; auth: { token: string } }>) {
  return { io: fakeIo(created) };
}

test.beforeEach(() => {
  disconnectSocket(); // resets generation, pending, and published socket
});

test('logout during import: stale resolve publishes no socket', async () => {
  const created: Array<{ url: string; auth: { token: string } }> = [];
  const d = deferred<ReturnType<typeof ioModule>>();
  const p = connectSocket('tok-a', () => d.promise as never);
  disconnectSocket(); // user logs out while the import is in flight
  d.resolve(ioModule(created));
  const result = await p;
  assert.equal(result, null);
  assert.equal(created.length, 0);
  assert.equal(getSocket(), null);
});

test('token refresh during import: old pending cannot publish', async () => {
  const created: Array<{ url: string; auth: { token: string } }> = [];
  const d1 = deferred<ReturnType<typeof ioModule>>();
  const pOld = connectSocket('tok-old', () => d1.promise as never);
  // Refresh swaps in a new token before the old import resolves.
  const d2 = deferred<ReturnType<typeof ioModule>>();
  const pNew = connectSocket('tok-new', () => d2.promise as never);
  d2.resolve(ioModule(created));
  d1.resolve(ioModule(created));
  const [oldRes, newRes] = await Promise.all([pOld, pNew]);
  assert.equal(oldRes, null);
  assert.ok(newRes);
  assert.equal(created.length, 1);
  assert.equal(created[0].auth.token, 'tok-new');
});

test('account switch: new account gets its own connection, not the pending one', async () => {
  const created: Array<{ url: string; auth: { token: string } }> = [];
  const d1 = deferred<ReturnType<typeof ioModule>>();
  const pA = connectSocket('user-a-token', () => d1.promise as never);
  const d2 = deferred<ReturnType<typeof ioModule>>();
  const pB = connectSocket('user-b-token', () => d2.promise as never);
  // B resolves first; A's late resolution must not clobber it.
  d2.resolve(ioModule(created));
  await pB;
  d1.resolve(ioModule(created));
  assert.equal(await pA, null);
  assert.equal(created.length, 1);
  assert.equal(created[0].auth.token, 'user-b-token');
});

test('import failure clears pending and a retry succeeds', async () => {
  const created: Array<{ url: string; auth: { token: string } }> = [];
  const d1 = deferred<ReturnType<typeof ioModule>>();
  const pFail = connectSocket('tok', () => d1.promise as never);
  d1.reject(new Error('chunk load failed'));
  await assert.rejects(pFail, /chunk load failed/);
  // Retry path: no stale pending gate.
  const d2 = deferred<ReturnType<typeof ioModule>>();
  const pRetry = connectSocket('tok', () => d2.promise as never);
  d2.resolve(ioModule(created));
  const s = await pRetry;
  assert.ok(s);
  assert.equal(created.length, 1);
});

test('same-token concurrent calls share one pending import', async () => {
  const created: Array<{ url: string; auth: { token: string } }> = [];
  const d = deferred<ReturnType<typeof ioModule>>();
  let imports = 0;
  const importer = () => {
    imports += 1;
    return d.promise as never;
  };
  const p1 = connectSocket('tok', importer);
  const p2 = connectSocket('tok', importer);
  d.resolve(ioModule(created));
  const [s1, s2] = await Promise.all([p1, p2]);
  assert.equal(imports, 1);
  assert.equal(created.length, 1);
  assert.equal(s1, s2);
});

test('already-connected socket with same token resolves without re-import', async () => {
  const created: Array<{ url: string; auth: { token: string } }> = [];
  const d = deferred<ReturnType<typeof ioModule>>();
  const p = connectSocket('tok', () => d.promise as never);
  d.resolve(ioModule(created));
  const s = await p;
  const again = await connectSocket('tok', () => {
    throw new Error('must not import again');
  });
  assert.equal(again, s);
});
