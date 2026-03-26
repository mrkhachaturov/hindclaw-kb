import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { getDbPath, EMBEDDING_DIMS, VECTOR_WEIGHT, TEXT_WEIGHT } from './config.js';

const require = createRequire(import.meta.url);

let db = null;
let vecLoaded = false;

export function openDb() {
  if (db) return db;

  const dbPath = getDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath, { allowExtension: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');

  try {
    const sqliteVec = require('sqlite-vec');
    sqliteVec.load(db);
    vecLoaded = true;
  } catch (e) {
    console.error(`Warning: sqlite-vec not available (${e.message}). Vector search disabled.`);
  }

  initSchema();
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
    vecLoaded = false;
    for (const key of Object.keys(stmtCache)) delete stmtCache[key];
  }
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      component TEXT,
      hash TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      run_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      component TEXT,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      text TEXT NOT NULL,
      content_type TEXT DEFAULT 'code',
      language TEXT,
      category TEXT,
      run_id INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
    CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);
    CREATE INDEX IF NOT EXISTS idx_chunks_component ON chunks(component);
    CREATE INDEX IF NOT EXISTS idx_chunks_content_type ON chunks(content_type);
    CREATE INDEX IF NOT EXISTS idx_chunks_run_id ON chunks(run_id);

    CREATE TABLE IF NOT EXISTS index_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      indexed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS component_versions (
      run_id INTEGER NOT NULL REFERENCES index_runs(id),
      component TEXT NOT NULL,
      tag TEXT NOT NULL,
      commit_hash TEXT NOT NULL,
      previous_tag TEXT,
      PRIMARY KEY (run_id, component)
    );
  `);

  // FTS5 for keyword search
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        text,
        id UNINDEXED,
        path UNINDEXED,
        source UNINDEXED,
        component UNINDEXED,
        content_type UNINDEXED,
        language UNINDEXED
      );
    `);
  } catch (e) {
    console.error(`Warning: FTS5 not available (${e.message}).`);
  }

  // Vector table via sqlite-vec
  if (vecLoaded) {
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
          id TEXT PRIMARY KEY,
          embedding float32[${EMBEDDING_DIMS}]
        );
      `);
    } catch (e) {
      if (!e.message.includes('already exists')) {
        console.error(`Warning: vec0 table creation failed (${e.message}).`);
        vecLoaded = false;
      }
    }
  }
}

// --- Statement cache ---

const stmtCache = {};
function prepare(sql) {
  if (!stmtCache[sql]) stmtCache[sql] = db.prepare(sql);
  return stmtCache[sql];
}

// --- Index run tracking ---

export function createIndexRun() {
  const result = prepare('INSERT INTO index_runs (indexed_at) VALUES (?)').run(Date.now());
  return Number(result.lastInsertRowid);
}

export function addComponentVersion(runId, component, tag, commitHash, previousTag = null) {
  prepare(`
    INSERT OR REPLACE INTO component_versions (run_id, component, tag, commit_hash, previous_tag)
    VALUES (?, ?, ?, ?, ?)
  `).run(runId, component, tag, commitHash, previousTag || null);
}

export function getLatestVersions() {
  return prepare(`
    SELECT cv.component, cv.tag, cv.commit_hash, cv.previous_tag, ir.indexed_at
    FROM component_versions cv
    JOIN index_runs ir ON cv.run_id = ir.id
    WHERE cv.run_id = (
      SELECT MAX(cv2.run_id) FROM component_versions cv2 WHERE cv2.component = cv.component
    )
    ORDER BY cv.component
  `).all();
}

export function getIndexHistory(limit = 10) {
  const runs = prepare(`
    SELECT id, indexed_at FROM index_runs ORDER BY id DESC LIMIT ?
  `).all(limit);

  return runs.map(run => {
    const versions = prepare(`
      SELECT component, tag, commit_hash FROM component_versions WHERE run_id = ?
    `).all(run.id);
    return { runId: run.id, indexedAt: run.indexed_at, components: versions };
  });
}

export function getChunksSinceComponentVersion(component, sinceTag) {
  // Find the run_id where this component had this tag
  const versionRow = prepare(`
    SELECT cv.run_id FROM component_versions cv
    WHERE cv.component = ? AND cv.tag = ?
    ORDER BY cv.run_id ASC LIMIT 1
  `).get(component, sinceTag);

  if (!versionRow) return [];

  // Return chunks for this component from runs after that one
  return prepare(`
    SELECT c.id, c.path, c.source, c.component, c.start_line as startLine, c.end_line as endLine,
           c.text, c.content_type as contentType, c.language, c.category, c.run_id as runId
    FROM chunks c
    JOIN files f ON c.path = f.path
    WHERE c.component = ? AND f.run_id > ?
    LIMIT 100
  `).all(component, versionRow.run_id);
}

// --- File tracking ---

export function getFileHash(path) {
  const row = prepare('SELECT hash FROM files WHERE path = ?').get(path);
  return row ? row.hash : null;
}

export function upsertFile(path, source, hash, component = null, runId = null) {
  prepare(`
    INSERT INTO files (path, source, component, hash, indexed_at, run_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET source=?, component=?, hash=?, indexed_at=?, run_id=?
  `).run(path, source, component, hash, Date.now(), runId, source, component, hash, Date.now(), runId);
}

export function updateFileRunId(path, runId) {
  prepare('UPDATE files SET run_id = ?, indexed_at = ? WHERE path = ?').run(runId, Date.now(), path);
}

export function getAllFilePaths() {
  return prepare('SELECT path FROM files').all().map(r => r.path);
}

export function deleteFile(path) {
  prepare('DELETE FROM files WHERE path = ?').run(path);
}

// --- Chunk operations ---

export function getChunkHashes(path) {
  return prepare('SELECT id, hash FROM chunks WHERE path = ?')
    .all(path)
    .reduce((map, r) => { map[r.id] = r.hash; return map; }, {});
}

export function deleteChunksByPath(path) {
  const ids = prepare('SELECT id FROM chunks WHERE path = ?').all(path).map(r => r.id);
  if (ids.length === 0) return;

  prepare('DELETE FROM chunks WHERE path = ?').run(path);

  for (const id of ids) {
    try { prepare('DELETE FROM chunks_fts WHERE id = ?').run(id); } catch { /* ignore */ }
  }

  if (vecLoaded) {
    for (const id of ids) {
      try { prepare('DELETE FROM chunks_vec WHERE id = ?').run(id); } catch { /* ignore */ }
    }
  }
}

export function pruneOrphanedVectors() {
  if (!vecLoaded) return 0;
  const before = db.prepare('SELECT COUNT(*) as n FROM chunks_vec WHERE id NOT IN (SELECT id FROM chunks)').get().n;
  if (before === 0) return 0;
  db.prepare('DELETE FROM chunks_vec WHERE id NOT IN (SELECT id FROM chunks)').run();
  return before;
}

export function insertChunks(chunks, embeddings, runId = null) {
  const insertChunk = prepare(`
    INSERT OR REPLACE INTO chunks (id, path, source, component, start_line, end_line, hash, text, content_type, language, category, run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertFts = prepare(`
    INSERT OR REPLACE INTO chunks_fts (text, id, path, source, component, content_type, language)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertVec = vecLoaded ? prepare(`
    INSERT OR REPLACE INTO chunks_vec (id, embedding) VALUES (?, ?)
  `) : null;

  db.exec('BEGIN');
  try {
    pruneOrphanedVectors();

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      insertChunk.run(
        c.id, c.path, c.source, c.component || null, c.startLine, c.endLine, c.hash, c.text,
        c.contentType || 'code', c.language || null, c.category || null, runId
      );

      try {
        insertFts.run(c.text, c.id, c.path, c.source, c.component || null, c.contentType || 'code', c.language || null);
      } catch (ftsErr) {
        console.error(`[db] FTS insert failed for chunk ${c.id}: ${ftsErr.message}`);
      }

      if (insertVec && embeddings[i]) {
        const blob = vectorToBlob(embeddings[i]);
        insertVec.run(c.id, blob);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// --- Search ---

export function searchVector(queryEmbedding, limit = 10, sourceFilter = null, contentTypeFilter = null) {
  if (!vecLoaded) return [];

  const blob = vectorToBlob(queryEmbedding);
  const candidateLimit = limit * 3;

  const rows = prepare(`
    SELECT v.id, v.distance FROM chunks_vec v
    WHERE v.embedding MATCH ? ORDER BY v.distance LIMIT ?
  `).all(blob, candidateLimit);

  const results = [];
  for (const row of rows) {
    const chunk = prepare('SELECT * FROM chunks WHERE id = ?').get(row.id);
    if (!chunk) continue;
    if (sourceFilter && chunk.source !== sourceFilter) continue;
    if (contentTypeFilter && chunk.content_type !== contentTypeFilter) continue;

    results.push({
      id: chunk.id, path: chunk.path, source: chunk.source,
      component: chunk.component,
      contentType: chunk.content_type, language: chunk.language, category: chunk.category,
      startLine: chunk.start_line, endLine: chunk.end_line, text: chunk.text,
      score: 1 - row.distance,
    });
    if (results.length >= limit) break;
  }
  return results;
}

export function searchFTS(query, limit = 10, sourceFilter = null, contentTypeFilter = null) {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  const candidateLimit = limit * 3;

  let sql, params;
  if (sourceFilter && contentTypeFilter) {
    sql = `SELECT id, path, source, component, content_type, language, text, rank FROM chunks_fts
           WHERE chunks_fts MATCH ? AND source = ? AND content_type = ? ORDER BY rank LIMIT ?`;
    params = [ftsQuery, sourceFilter, contentTypeFilter, candidateLimit];
  } else if (sourceFilter) {
    sql = `SELECT id, path, source, component, content_type, language, text, rank FROM chunks_fts
           WHERE chunks_fts MATCH ? AND source = ? ORDER BY rank LIMIT ?`;
    params = [ftsQuery, sourceFilter, candidateLimit];
  } else if (contentTypeFilter) {
    sql = `SELECT id, path, source, component, content_type, language, text, rank FROM chunks_fts
           WHERE chunks_fts MATCH ? AND content_type = ? ORDER BY rank LIMIT ?`;
    params = [ftsQuery, contentTypeFilter, candidateLimit];
  } else {
    sql = `SELECT id, path, source, component, content_type, language, text, rank FROM chunks_fts
           WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?`;
    params = [ftsQuery, candidateLimit];
  }

  try {
    const rows = prepare(sql).all(...params);
    return rows.map(r => {
      const chunk = prepare('SELECT * FROM chunks WHERE id = ?').get(r.id);
      return {
        id: r.id, path: chunk ? chunk.path : r.path,
        source: chunk ? chunk.source : r.source,
        component: chunk ? chunk.component : r.component,
        contentType: chunk ? chunk.content_type : r.content_type,
        language: chunk ? chunk.language : r.language,
        category: chunk ? chunk.category : null,
        startLine: chunk ? chunk.start_line : 0, endLine: chunk ? chunk.end_line : 0,
        text: r.text,
        score: bm25RankToScore(r.rank),
      };
    }).slice(0, limit);
  } catch {
    return [];
  }
}

export function hybridSearch(queryEmbedding, queryText, limit = 8, sourceFilter = null, contentTypeFilter = null) {
  const vecResults = searchVector(queryEmbedding, limit * 2, sourceFilter, contentTypeFilter);
  const ftsResults = searchFTS(queryText, limit * 2, sourceFilter, contentTypeFilter);

  const vectorRanks = new Map();
  const textRanks = new Map();
  vecResults.forEach((r, idx) => vectorRanks.set(r.id, idx + 1));
  ftsResults.forEach((r, idx) => textRanks.set(r.id, idx + 1));

  const merged = new Map();
  for (const r of vecResults) {
    merged.set(r.id, { ...r, vectorRank: vectorRanks.get(r.id), textRank: null });
  }
  for (const r of ftsResults) {
    if (merged.has(r.id)) {
      merged.get(r.id).textRank = textRanks.get(r.id);
    } else {
      merged.set(r.id, { ...r, vectorRank: null, textRank: textRanks.get(r.id) });
    }
  }

  const RRF_K = 60;
  const results = [...merged.values()].map(r => {
    const vectorComponent = r.vectorRank ? 1 / (RRF_K + r.vectorRank) : 0;
    const textComponent = r.textRank ? 1 / (RRF_K + r.textRank) : 0;
    return { ...r, score: vectorComponent + textComponent };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map(r => ({
    id: r.id, path: r.path, source: r.source, component: r.component,
    contentType: r.contentType, language: r.language, category: r.category,
    startLine: r.startLine, endLine: r.endLine, text: r.text, score: r.score,
  }));
}

// --- Stats ---

export function getStats() {
  const files = prepare('SELECT COUNT(*) as n FROM files').get().n;
  const chunks = prepare('SELECT COUNT(*) as n FROM chunks').get().n;
  const sources = prepare('SELECT source, COUNT(*) as n FROM chunks GROUP BY source ORDER BY n DESC').all();
  const components = prepare('SELECT component, COUNT(*) as n FROM chunks GROUP BY component ORDER BY n DESC').all();
  return { files, chunks, sources, components, vecLoaded };
}

// --- Helpers ---

function vectorToBlob(embedding) {
  return Buffer.from(new Float32Array(embedding).buffer);
}

function buildFtsQuery(raw) {
  const tokens = raw
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
  if (tokens.length === 0) return null;
  return tokens.map(t => `"${t}"`).join(' OR ');
}

function bm25RankToScore(rank) {
  return Math.max(0, 1 + rank / 10);
}
