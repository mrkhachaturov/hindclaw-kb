// tests/db.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('db', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hindclaw-kb-test-'));
    process.env.KB_DATA_DIR = tmpDir;
  });

  after(async () => {
    // Dynamic import so env is set before config reads it
    const { closeDb } = await import('../lib/db.js');
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KB_DATA_DIR;
  });

  it('opens database and creates schema', async () => {
    const { openDb, closeDb } = await import('../lib/db.js');
    const db = openDb();
    assert.ok(db);

    // Verify core tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    assert.ok(tables.includes('files'), 'files table exists');
    assert.ok(tables.includes('chunks'), 'chunks table exists');
    assert.ok(tables.includes('index_runs'), 'index_runs table exists');
    assert.ok(tables.includes('component_versions'), 'component_versions table exists');

    closeDb();
  });

  it('tracks index runs with component versions', async () => {
    const { openDb, closeDb, createIndexRun, addComponentVersion, getLatestVersions } = await import('../lib/db.js');
    openDb();

    const runId = createIndexRun();
    assert.ok(runId > 0);

    addComponentVersion(runId, 'hindclaw', 'ext-v0.1.0', 'abc1234');
    addComponentVersion(runId, 'hindclaw-openclaw-plugin', 'v0.2.0', 'def5678');

    const versions = getLatestVersions();
    assert.equal(versions.length, 2);

    const hindclaw = versions.find(v => v.component === 'hindclaw');
    assert.equal(hindclaw.tag, 'ext-v0.1.0');

    closeDb();
  });

  it('getStats returns per-component counts', async () => {
    const { openDb, closeDb, getStats } = await import('../lib/db.js');
    openDb();
    const stats = getStats();
    assert.ok('files' in stats);
    assert.ok('chunks' in stats);
    assert.ok('sources' in stats);
    closeDb();
  });
});
