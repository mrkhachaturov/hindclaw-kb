import { openDb, closeDb, hybridSearch, searchFTS } from '../lib/db.js';
import { embedQuery } from '../lib/embedder.js';
import { expandQuery } from '../lib/synonyms.js';
import { EMBEDDING_PROVIDER } from '../lib/config.js';
import { EXIT_SUCCESS, EXIT_RUNTIME_ERROR, EXIT_CONFIG_ERROR, EXIT_NO_RESULTS } from '../lib/exit-codes.js';

function serializeResult(r) {
  return {
    score: Math.round(r.score * 1000) / 1000,
    path: r.path,
    lines: `${r.startLine}-${r.endLine}`,
    source: r.source,
    component: r.component,
    contentType: r.contentType,
    language: r.language,
    category: r.category,
    snippet: r.text.slice(0, 800),
  };
}

export function formatJsonOutput(query, results, relatedCode = []) {
  return JSON.stringify({
    query,
    results: results.map(serializeResult),
    ...(relatedCode.length > 0 ? { relatedCode: relatedCode.map(serializeResult) } : {}),
  }, null, 2);
}

export function register(program) {
  program
    .command('query <text...>')
    .description('Search the Hindclaw knowledge base')
    .option('--extension', 'Filter to extension source')
    .option('--integrations', 'Filter to integrations source')
    .option('--terraform', 'Filter to terraform source')
    .option('--tests', 'Filter to test files')
    .option('--verify', 'Two-pass: code then related tests')
    .option('--json', 'Output JSON')
    .option('--top <n>', 'Number of results', '8')
    .option('--offline', 'FTS-only keyword search (no API needed)')
    .action(async (textParts, opts) => {
      await handler({ query: textParts.join(' '), ...opts });
    });
}

export async function handler(opts) {
  const {
    query, extension, integrations, terraform, tests,
    verify, json, top = '8', offline = false,
  } = opts;

  if (!query || !query.trim()) {
    console.error('Usage: hindclaw-kb query <text>');
    process.exit(EXIT_CONFIG_ERROR);
  }

  try {
    openDb();
    const limit = parseInt(top, 10) || 8;

    let sourceFilter = null;
    let contentTypeFilter = null;

    if (extension) sourceFilter = 'extension';
    else if (integrations) sourceFilter = 'integrations-openclaw';
    else if (terraform) sourceFilter = 'terraform';

    if (tests) contentTypeFilter = 'test';

    const expandedQuery = expandQuery(query);

    let results;
    if (offline) {
      results = searchFTS(expandedQuery, limit, sourceFilter, contentTypeFilter);
    } else {
      if (EMBEDDING_PROVIDER === 'openai' && !process.env.OPENAI_API_KEY) {
        console.error('OPENAI_API_KEY is required. Use --offline for keyword search.');
        process.exit(EXIT_CONFIG_ERROR);
      }
      const queryEmbedding = await embedQuery(expandedQuery);
      results = hybridSearch(queryEmbedding, expandedQuery, limit, sourceFilter, contentTypeFilter);
    }

    // Verify mode: append test results after code
    let codeResults = [];
    if (verify && results.length > 0 && !offline) {
      const testEmbedding = await embedQuery(expandedQuery);
      codeResults = hybridSearch(testEmbedding, expandedQuery, 5, null, 'test');
    }

    if (results.length === 0) {
      if (json) console.log(formatJsonOutput(query, []));
      else console.log('No results found.');
      closeDb();
      process.exit(EXIT_NO_RESULTS);
    }

    if (json) {
      console.log(formatJsonOutput(query, results, codeResults));
    } else {
      console.log(`Query: "${query}"`);
      if (sourceFilter) console.log(`Filter: source=${sourceFilter}`);
      if (contentTypeFilter) console.log(`Filter: type=${contentTypeFilter}`);
      if (offline) console.log('Mode: offline (FTS-only)');
      console.log(`Results: ${results.length}\n`);

      for (const r of results) {
        const scoreStr = r.score.toFixed(3);
        const compTag = r.component ? `[${r.component}]` : '';
        console.log(`[${scoreStr}] ${compTag} ${r.path}:${r.startLine}-${r.endLine} (${r.source})`);
        const lines = r.text.split('\n').slice(1, 4);
        for (const line of lines) {
          const trimmed = line.length > 120 ? line.slice(0, 117) + '...' : line;
          console.log(`  ${trimmed}`);
        }
        console.log('');
      }

      if (verify && codeResults.length > 0) {
        console.log('\n--- Related Tests ---\n');
        for (const r of codeResults) {
          const scoreStr = r.score.toFixed(3);
          console.log(`[${scoreStr}] [test] ${r.path}:${r.startLine}-${r.endLine} (${r.source})`);
          const lines = r.text.split('\n').slice(1, 4);
          for (const line of lines) {
            const trimmed = line.length > 120 ? line.slice(0, 117) + '...' : line;
            console.log(`  ${trimmed}`);
          }
          console.log('');
        }
      }
    }

    closeDb();
    process.exit(EXIT_SUCCESS);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(EXIT_RUNTIME_ERROR);
  }
}
