import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { getHindclawRoot, getActiveSources, EMBEDDING_PROVIDER } from '../lib/config.js';
import { chunkFile } from '../lib/chunker.js';
import { embedAll } from '../lib/embedder.js';
import { resolveAllVersions, getComponentForPath } from '../lib/components.js';
import {
  openDb, closeDb,
  getFileHash, upsertFile, updateFileRunId, getAllFilePaths, deleteFile,
  deleteChunksByPath, insertChunks, getStats,
  createIndexRun, addComponentVersion, getLatestVersions,
} from '../lib/db.js';
import { EXIT_CONFIG_ERROR, EXIT_RUNTIME_ERROR } from '../lib/exit-codes.js';

export function register(program) {
  program
    .command('index')
    .description('Index Hindclaw source code into the vector database')
    .option('--force', 'Re-index all files regardless of hash', false)
    .option('--extra-sources <list>', 'Comma-separated phase 2 sources to include', '')
    .action(async (opts) => {
      try {
        await handler(opts);
      } catch (err) {
        console.error('Fatal:', err);
        process.exit(EXIT_RUNTIME_ERROR);
      }
    });
}

export async function handler(opts) {
  const force = opts.force ?? false;
  const extraSources = opts.extraSources ? opts.extraSources.split(',').map(s => s.trim()) : null;
  const activeSources = getActiveSources(extraSources || undefined);
  const rootDir = getHindclawRoot();

  console.log('Hindclaw Knowledge Base Indexer');
  console.log(`Root: ${rootDir}`);
  console.log(`Force: ${force}\n`);

  if (!existsSync(rootDir)) {
    console.error(`Error: Hindclaw root not found at ${rootDir}`);
    console.error('Set HINDCLAW_ROOT_DIR to the hindclaw working tree');
    process.exit(EXIT_CONFIG_ERROR);
  }

  if (EMBEDDING_PROVIDER === 'openai' && !process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY not set.');
    process.exit(EXIT_CONFIG_ERROR);
  }

  openDb();

  // Create index run and resolve component versions
  const runId = createIndexRun();
  const versions = resolveAllVersions(rootDir);

  console.log('Component versions:');
  for (const [name, ver] of versions) {
    console.log(`  ${name}: ${ver.tag || 'untagged'} (${ver.commitHash || 'unknown'})`);
    if (ver.tag) {
      addComponentVersion(runId, name, ver.tag, ver.commitHash || '');
    }
  }
  console.log('');

  const allDiscoveredPaths = new Set();
  let totalNew = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalDeleted = 0;

  for (const source of activeSources) {
    console.log(`\n--- Source: ${source.name} ---`);
    const files = discoverFiles(source, rootDir);
    console.log(`  Found ${files.length} files`);

    const chunksToEmbed = [];
    const chunkMetadata = [];

    for (const filePath of files) {
      const relPath = relative(rootDir, filePath);
      allDiscoveredPaths.add(relPath);

      // Resolve component per file, not per source — critical for multi-component
      // sources like integration-tests which span both plugin repos
      const fileComponent = source.component || getComponentForPath(relPath).name;

      const content = readFileSync(filePath, 'utf-8');
      const fileHash = createHash('sha256').update(content).digest('hex');
      const existingHash = getFileHash(relPath);

      if (!force && existingHash === fileHash) {
        // Hash unchanged — update run_id so it reports as part of this run
        updateFileRunId(relPath, runId);
        totalSkipped++;
        continue;
      }

      if (existingHash) {
        totalUpdated++;
        deleteChunksByPath(relPath);
      } else {
        totalNew++;
      }

      const chunks = chunkFile(content, relPath, source.name);
      for (const chunk of chunks) {
        chunk.component = fileComponent;
        chunksToEmbed.push(chunk);
        chunkMetadata.push(chunk);
      }

      upsertFile(relPath, source.name, fileHash, fileComponent, runId);
    }

    if (chunksToEmbed.length === 0) {
      console.log(`  No changes to embed`);
      continue;
    }

    console.log(`  Embedding ${chunksToEmbed.length} chunks...`);
    const texts = chunksToEmbed.map(c => c.text);
    const embeddings = await embedAll(texts, (done, total) => {
      process.stdout.write(`\r  Embedding: ${done}/${total} chunks`);
    });
    console.log('');

    insertChunks(chunkMetadata, embeddings, runId);
    console.log(`  Inserted ${chunkMetadata.length} chunks`);

    // Validate FTS
    const dbRef = openDb();
    const ftsCount = dbRef.prepare('SELECT COUNT(*) as n FROM chunks_fts').get().n;
    const chunksCount = dbRef.prepare('SELECT COUNT(*) as n FROM chunks').get().n;
    if (ftsCount < chunksCount * 0.9) {
      console.warn(`  WARNING: FTS table has ${ftsCount} rows but chunks has ${chunksCount} rows`);
    } else {
      console.log(`  FTS table verified: ${ftsCount} rows`);
    }
  }

  // Clean up deleted files
  const indexedPaths = getAllFilePaths();
  for (const path of indexedPaths) {
    if (!allDiscoveredPaths.has(path)) {
      deleteChunksByPath(path);
      deleteFile(path);
      totalDeleted++;
    }
  }

  // Summary
  const stats = getStats();
  console.log('\n=== Summary ===');
  console.log(`Files: ${stats.files} indexed`);
  console.log(`Chunks: ${stats.chunks} total`);
  console.log(`Changes: ${totalNew} new, ${totalUpdated} updated, ${totalSkipped} skipped, ${totalDeleted} deleted`);
  console.log(`Vector search: ${stats.vecLoaded ? 'enabled' : 'DISABLED'}`);
  console.log('Sources:');
  for (const s of stats.sources) {
    console.log(`  ${s.source}: ${s.n} chunks`);
  }
  console.log('Components:');
  for (const c of stats.components) {
    console.log(`  ${c.component}: ${c.n} chunks`);
  }

  closeDb();
}

// --- File discovery (ported from hindsight-kb) ---

function discoverFiles(source, rootDir) {
  const results = [];
  for (const glob of source.globs) {
    const files = expandGlob(rootDir, glob);
    for (const f of files) {
      const relPath = relative(rootDir, f);
      const excluded = (source.exclude || []).some(pattern => matchGlob(relPath, pattern));
      if (!excluded) results.push(f);
    }
  }
  return [...new Set(results)].sort();
}

function expandGlob(root, pattern) {
  return walkGlob(root, pattern.split('/'));
}

function walkGlob(dir, parts) {
  if (parts.length === 0 || !existsSync(dir)) return [];

  const [current, ...rest] = parts;
  const results = [];

  if (current === '**') {
    results.push(...walkGlob(dir, rest));
    for (const entry of safeReaddir(dir)) {
      const full = join(dir, entry);
      if (isDir(full) && !shouldSkipDirectory(entry)) {
        results.push(...walkGlob(full, parts));
      }
    }
  } else if (current.includes('*')) {
    const regex = new RegExp('^' + current.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    for (const entry of safeReaddir(dir)) {
      const full = join(dir, entry);
      if (regex.test(entry)) {
        if (rest.length === 0) { if (!isDir(full)) results.push(full); }
        else { if (isDir(full)) results.push(...walkGlob(full, rest)); }
      }
    }
  } else {
    const full = join(dir, current);
    if (rest.length === 0) { if (existsSync(full) && !isDir(full)) results.push(full); }
    else { if (existsSync(full) && isDir(full)) results.push(...walkGlob(full, rest)); }
  }
  return results;
}

function matchGlob(path, pattern) {
  const regex = new RegExp(
    '^' + pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<<GLOBSTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<<GLOBSTAR>>>/g, '.*')
    + '$'
  );
  return regex.test(path);
}

function safeReaddir(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function shouldSkipDirectory(name) {
  return ['node_modules', '.git', '__pycache__', '.next', 'dist', 'venv',
    '.terraform', '.pytest_cache', 'build'].includes(name);
}
