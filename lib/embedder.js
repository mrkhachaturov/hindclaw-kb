import { EMBEDDING_MODEL, EMBEDDING_API_URL, EMBEDDING_BATCH_SIZE, EMBEDDING_PROVIDER, LOCAL_MODEL } from './config.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

let localPipeline = null;

async function getLocalPipeline() {
  if (localPipeline) return localPipeline;
  try {
    const { pipeline } = await import('@huggingface/transformers');
    localPipeline = await pipeline('feature-extraction', `Xenova/${LOCAL_MODEL}`);
    return localPipeline;
  } catch (err) {
    console.error('Error: Local embedding requires @huggingface/transformers');
    console.error('Install it: npm install @huggingface/transformers');
    process.exit(2);
  }
}

export async function embedQuery(text) {
  if (EMBEDDING_PROVIDER === 'local') {
    return embedLocalSingle(text);
  }
  const [embedding] = await embedBatchOpenAI([text]);
  return embedding;
}

export async function embedAll(texts, onProgress) {
  if (EMBEDDING_PROVIDER === 'local') {
    return embedLocalBatch(texts, onProgress);
  }
  return embedAllOpenAI(texts, onProgress);
}

async function embedAllOpenAI(texts, onProgress) {
  const results = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const embeddings = await embedBatchOpenAI(batch);
    results.push(...embeddings);
    if (onProgress) {
      onProgress(Math.min(i + EMBEDDING_BATCH_SIZE, texts.length), texts.length);
    }
  }
  return results;
}

async function embedBatchOpenAI(texts) {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is required. Set it in your environment or pass --env-file.');
    process.exit(2);
  }
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(EMBEDDING_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
    });

    if (res.ok) {
      const json = await res.json();
      return json.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      const retryAfter = res.headers.get('retry-after');
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
      console.error(`  Rate limited, retrying in ${waitMs}ms...`);
      await sleep(waitMs);
      continue;
    }

    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }
}

async function embedLocalSingle(text) {
  const pipe = await getLocalPipeline();
  const result = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}

async function embedLocalBatch(texts, onProgress) {
  const pipe = await getLocalPipeline();
  const results = [];
  for (let i = 0; i < texts.length; i++) {
    const result = await pipe(texts[i], { pooling: 'mean', normalize: true });
    results.push(Array.from(result.data));
    if (onProgress && (i + 1) % 10 === 0) {
      onProgress(i + 1, texts.length);
    }
  }
  if (onProgress) onProgress(texts.length, texts.length);
  return results;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
