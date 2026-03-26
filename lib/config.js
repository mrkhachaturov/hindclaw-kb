import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Getter functions (read env at call time, so CLI overrides work after import) ---

export function getHindclawRoot() {
  return process.env.HINDCLAW_ROOT_DIR
    ? resolve(process.env.HINDCLAW_ROOT_DIR)
    : resolve(join(__dirname, '..', 'source'));
}

export function getKbDataDir() {
  return process.env.KB_DATA_DIR
    ? resolve(process.env.KB_DATA_DIR)
    : resolve(join(__dirname, '..', 'data'));
}

export function getDbPath() {
  return join(getKbDataDir(), 'hindclaw.db');
}

export function getLogDir() {
  return process.env.KB_LOG_DIR
    ? resolve(process.env.KB_LOG_DIR)
    : join(getKbDataDir(), 'log');
}

// --- Embedding config ---

export const EMBEDDING_MODEL = process.env.KB_EMBEDDING_MODEL || 'text-embedding-3-small';
export const EMBEDDING_PROVIDER = process.env.KB_EMBEDDING_PROVIDER || 'openai';
export const LOCAL_MODEL = process.env.KB_LOCAL_MODEL || 'all-MiniLM-L6-v2';

function getEmbeddingDims(model) {
  const dims = {
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'nomic-embed-text-v2': 768,
    'all-MiniLM-L6-v2': 384,
  };
  return dims[model] || 1536;
}

export const EMBEDDING_DIMS = EMBEDDING_PROVIDER === 'local'
  ? getEmbeddingDims(LOCAL_MODEL)
  : getEmbeddingDims(EMBEDDING_MODEL);

export const CHUNK_MAX_CHARS = 1600;
export const CHUNK_OVERLAP_CHARS = 200;
export const EMBEDDING_BATCH_SIZE = 50;
export const EMBEDDING_API_URL = 'https://api.openai.com/v1/embeddings';
export const MAX_EMBEDDING_SAFE_CHARS = 6000;

// --- Search weights ---

export const VECTOR_WEIGHT = 0.7;
export const TEXT_WEIGHT = 0.3;

// --- Components ---

export const COMPONENTS = [
  {
    name: 'hindclaw',
    description: 'Core repo (extension, CLI, docs)',
    path: '.',
    tagPattern: /^ext-v/,
  },
  {
    name: 'hindclaw-openclaw-plugin',
    description: 'OpenClaw integration plugin',
    path: 'hindclaw-integrations/openclaw',
    tagPattern: /^v/,
  },
  {
    name: 'hindclaw-claude-plugin',
    description: 'Claude Code integration plugin',
    path: 'hindclaw-integrations/claude-code',
    tagPattern: /^v/,
  },
  {
    name: 'terraform-provider-hindclaw',
    description: 'Terraform provider for Hindclaw',
    path: 'hindclaw-terraform',
    tagPattern: /^v/,
  },
];

// --- Sources ---

export const SOURCES = [
  // Phase 1
  {
    name: 'extension',
    component: 'hindclaw',
    globs: ['hindclaw-extension/hindclaw_ext/**/*.py'],
    exclude: ['**/__pycache__/**', '**/*.pyc'],
  },
  {
    name: 'integrations-openclaw',
    component: 'hindclaw-openclaw-plugin',
    globs: ['hindclaw-integrations/openclaw/src/**/*.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.min.js', '**/*.bundle.js'],
  },
  {
    name: 'integrations-claude-code',
    component: 'hindclaw-claude-plugin',
    globs: ['hindclaw-integrations/claude-code/**/*.py'],
    exclude: ['**/__pycache__/**', '**/*.pyc'],
  },
  {
    name: 'terraform',
    component: 'terraform-provider-hindclaw',
    globs: ['hindclaw-terraform/**/*.go', 'hindclaw-terraform/**/*.tf', 'hindclaw-terraform/**/*.tpl'],
    exclude: ['**/.terraform/**', '**/terraform.tfstate*'],
  },
  // Phase 2
  {
    name: 'extension-tests',
    component: 'hindclaw',
    phase: 2,
    globs: ['hindclaw-extension/tests/**/*.py'],
    exclude: ['**/__pycache__/**', '**/*.pyc'],
  },
  {
    name: 'integration-tests',
    phase: 2,
    globs: [
      'hindclaw-integrations/openclaw/**/*.test.ts',
      'hindclaw-integrations/openclaw/tests/**/*.ts',
      'hindclaw-integrations/claude-code/tests/**/*.py',
    ],
    exclude: ['**/__pycache__/**', '**/*.pyc', '**/node_modules/**', '**/dist/**'],
  },
];

// --- Phase gating ---

export function getExtraSources() {
  const raw = process.env.KB_EXTRA_SOURCES ?? '';
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function getActiveSources(extraSources = null) {
  const extras = extraSources || getExtraSources();
  return SOURCES.filter(s => !s.phase || extras.includes(s.name));
}
