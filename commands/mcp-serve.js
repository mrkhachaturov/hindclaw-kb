import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import {
  openDb, hybridSearch, searchFTS, getStats,
  getLatestVersions, getIndexHistory, getChunksSinceComponentVersion,
} from '../lib/db.js';
import { embedQuery } from '../lib/embedder.js';
import { expandQuery } from '../lib/synonyms.js';
import { EMBEDDING_PROVIDER } from '../lib/config.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

export function register(program) {
  program
    .command('mcp-serve')
    .description('Start MCP server (stdio transport)')
    .action(() => handler());
}

export async function handler() {
  try {
    openDb();
  } catch (err) {
    console.error(`Failed to open database: ${err.message}`);
    process.exit(1);
  }

  const server = new McpServer({
    name: 'hindclaw-kb',
    version: pkg.version,
  });

  // --- Search tools ---

  server.tool(
    'search',
    'Hybrid search across the Hindclaw knowledge base. Combines vector similarity + keyword matching.',
    {
      query: z.string().describe('Search text'),
      mode: z.enum(['code', 'extension', 'integrations', 'terraform', 'tests', 'verify']).optional().describe('Content filter'),
      top: z.number().default(8).describe('Max results'),
      offline: z.boolean().default(false).describe('FTS-only keyword search, no API key needed'),
    },
    async ({ query, mode, top, offline }) => {
      return await doSearch(query, mode, top, offline);
    }
  );

  server.tool(
    'search_code',
    'Search all Hindclaw code sources.',
    { query: z.string().describe('Search text'), top: z.number().default(8).describe('Max results') },
    async ({ query, top }) => await doSearch(query, 'code', top, false)
  );

  server.tool(
    'search_extension',
    'Search Hindclaw extension code only.',
    { query: z.string().describe('Search text'), top: z.number().default(8).describe('Max results') },
    async ({ query, top }) => await doSearch(query, 'extension', top, false)
  );

  server.tool(
    'search_integrations',
    'Search Hindclaw integration code only.',
    { query: z.string().describe('Search text'), top: z.number().default(8).describe('Max results') },
    async ({ query, top }) => await doSearch(query, 'integrations', top, false)
  );

  server.tool(
    'search_terraform',
    'Search Hindclaw Terraform/provider code only.',
    { query: z.string().describe('Search text'), top: z.number().default(8).describe('Max results') },
    async ({ query, top }) => await doSearch(query, 'terraform', top, false)
  );

  server.tool(
    'search_tests',
    'Search Hindclaw test files.',
    { query: z.string().describe('Search text'), top: z.number().default(8).describe('Max results') },
    async ({ query, top }) => await doSearch(query, 'tests', top, false)
  );

  // --- Metadata tools ---

  server.tool(
    'get_stats',
    'Show database statistics including per-component chunk counts.',
    {},
    async () => {
      const stats = getStats();
      return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    }
  );

  server.tool(
    'get_latest',
    'Show the latest indexed version for each Hindclaw component.',
    {},
    async () => {
      const versions = getLatestVersions();
      if (versions.length === 0) {
        return { content: [{ type: 'text', text: 'No components indexed yet' }] };
      }
      const formatted = versions.map(v => ({
        component: v.component,
        tag: v.tag,
        commit: v.commit_hash,
        indexedAt: new Date(v.indexed_at).toISOString(),
      }));
      return { content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }] };
    }
  );

  server.tool(
    'get_history',
    'Show last 10 index runs with per-component versions.',
    {},
    async () => {
      const history = getIndexHistory(10);
      if (history.length === 0) {
        return { content: [{ type: 'text', text: 'No index runs yet' }] };
      }
      const formatted = history.map(run => ({
        runId: run.runId,
        indexedAt: new Date(run.indexedAt).toISOString(),
        components: run.components,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }] };
    }
  );

  server.tool(
    'get_since',
    'Show chunks indexed since a specific component version.',
    {
      component: z.string().describe('Component name (e.g. hindclaw, hindclaw-openclaw-plugin)'),
      version: z.string().describe('Version tag (e.g. ext-v0.1.0, v0.2.0)'),
    },
    async ({ component, version }) => {
      const chunks = getChunksSinceComponentVersion(component, version);
      if (chunks.length === 0) {
        return { content: [{ type: 'text', text: `No chunks found for ${component} since ${version}` }] };
      }
      const bySource = {};
      for (const c of chunks) {
        if (!bySource[c.source]) bySource[c.source] = [];
        bySource[c.source].push({ path: c.path, lines: `${c.startLine}-${c.endLine}` });
      }
      return { content: [{ type: 'text', text: JSON.stringify(bySource, null, 2) }] };
    }
  );

  // --- Start server ---

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('hindclaw-kb MCP server running on stdio');
}

// --- Shared search logic ---

async function doSearch(query, mode, top, offline) {
  let sourceFilter = null;
  let contentTypeFilter = null;

  if (mode === 'code') contentTypeFilter = 'code';
  else if (mode === 'extension') sourceFilter = 'extension';
  else if (mode === 'integrations') sourceFilter = 'integrations-openclaw';
  else if (mode === 'terraform') sourceFilter = 'terraform';
  else if (mode === 'tests') contentTypeFilter = 'test';

  const expandedQuery = expandQuery(query);

  let results;
  if (offline) {
    results = searchFTS(expandedQuery, top, sourceFilter, contentTypeFilter);
  } else {
    if (EMBEDDING_PROVIDER === 'openai' && !process.env.OPENAI_API_KEY) {
      return {
        content: [{ type: 'text', text: 'OPENAI_API_KEY required for vector search. Use offline: true for keyword-only search.' }],
        isError: true,
      };
    }
    const queryEmbedding = await embedQuery(expandedQuery);
    results = hybridSearch(queryEmbedding, expandedQuery, top, sourceFilter, contentTypeFilter);
  }

  // Verify mode: append test results
  if (mode === 'verify' && results.length > 0 && !offline) {
    const testEmbedding = await embedQuery(expandedQuery);
    const testResults = hybridSearch(testEmbedding, expandedQuery, 5, null, 'test');
    results = [...results, ...testResults];
  }

  if (results.length === 0) {
    return { content: [{ type: 'text', text: 'No results found.' }] };
  }

  const formatted = results.map(r => ({
    score: Math.round(r.score * 1000) / 1000,
    path: r.path,
    lines: `${r.startLine}-${r.endLine}`,
    source: r.source,
    component: r.component,
    contentType: r.contentType,
    language: r.language,
    category: r.category,
    snippet: r.text.slice(0, 800),
  }));

  return { content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }] };
}
