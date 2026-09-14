/**
 * store.mjs — one shared store for the app server and the admin console.
 *
 * Both processes need the same files: the app server creates accounts, tickets
 * and enquiry messages; the admin console reads those tickets and writes
 * replies back. Two processes writing one JSON document needs three things, and
 * this module provides all three:
 *
 *   1. an atomic write   — temp file + rename, so a reader never sees a partial
 *                          document and a crash never truncates the store
 *   2. an advisory lock  — a lockfile, so two writers cannot interleave a
 *                          read-modify-write and silently drop each other's work
 *   3. change detection  — mtime, so a long-running process notices that the
 *                          other process wrote and reloads before its next write
 *
 * Paths honour RP_DATA_DIR so a test run (or a second deployment) can use its
 * own directory instead of the live data/ folder.
 */
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync,
  statSync, openSync, closeSync, unlinkSync
} from 'node:fs';
import { join } from 'node:path';

export const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
export const DATA = process.env.RP_DATA_DIR || join(ROOT, 'data');
export const STORE = join(DATA, 'store.json');
export const OUTBOX = join(DATA, 'outbox');
export const LOCK = join(DATA, '.store.lock');

export const EMPTY = { users: [], sessions: [], tickets: [], audit: [], counters: { ticket: 1000 } };

/** a blocking sleep without a dependency (used only while waiting for the lock) */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function ensureDataDir() { mkdirSync(DATA, { recursive: true }); }

/**
 * A fingerprint of the current store. Writes go through a temp file + rename,
 * so the inode changes on every write — which matters, because Linux stamps
 * file times from the coarse clock and two writers can land in the same tick
 * and look identical by mtime alone. inode + size + mtimeNs cannot collide.
 */
export function statMtime() {
  try {
    const st = statSync(STORE, { bigint: true });
    return `${st.ino}:${st.size}:${st.mtimeNs}`;
  } catch (e) { return 0; }
}

export function readStore() {
  ensureDataDir();
  if (!existsSync(STORE)) return JSON.parse(JSON.stringify(EMPTY));
  try {
    const parsed = JSON.parse(readFileSync(STORE, 'utf8'));
    return Object.assign(JSON.parse(JSON.stringify(EMPTY)), parsed);
  } catch (e) {
    /* a corrupt store must not take the service down: keep the bad file for forensics */
    try { renameSync(STORE, STORE + '.corrupt-' + Date.now()); } catch (e2) { /* ignore */ }
    return JSON.parse(JSON.stringify(EMPTY));
  }
}

export function writeStore(db) {
  ensureDataDir();
  const tmp = STORE + '.tmp-' + process.pid;
  writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  renameSync(tmp, STORE);
}

/** run fn(store) with the lock held, then persist whatever fn returns (or mutated) */
export function withStore(fn) {
  ensureDataDir();
  const deadline = Date.now() + 1500;
  let fd = null;
  for (;;) {
    try { fd = openSync(LOCK, 'wx'); break; }
    catch (e) {
      if (e.code !== 'EEXIST') break;
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 5000) { unlinkSync(LOCK); continue; }  // stale lock
      } catch (e2) { /* the other writer released it */ }
      if (Date.now() > deadline) break;                                                  // fail-open, logged below
      sleep(25);
    }
  }
  if (fd === null && existsSync(LOCK)) {
    /* extremely rare: proceed unlocked rather than fail the request, and say so */
    process.emitWarning('store lock timed out; writing without the lock');
  }
  try {
    const db = readStore();
    const result = fn(db);
    writeStore(db);
    return result;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch (e) {} try { unlinkSync(LOCK); } catch (e) {} }
  }
}

/** the fingerprint a caller last saw, and whether the store changed since */
export function changedSince(seen) {
  const now = statMtime();
  return now !== 0 && now !== seen ? now : 0;
}
