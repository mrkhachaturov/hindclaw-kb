import { createHash } from 'node:crypto';
import { CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS, MAX_EMBEDDING_SAFE_CHARS } from './config.js';

const MAX_LINE_FRAGMENT_CHARS = Math.max(500, MAX_EMBEDDING_SAFE_CHARS - 250);

function deriveMetadata(relPath, source) {
  const ext = relPath.split('.').pop();

  const langMap = {
    'py': 'python', 'go': 'go', 'ts': 'typescript', 'tsx': 'typescript',
    'tf': 'hcl', 'tpl': 'template',
  };
  const language = langMap[ext] || null;

  let contentType = 'code';
  if (source === 'extension-tests' || source === 'integration-tests') {
    contentType = 'test';
  }

  const categoryMap = {
    'extension': 'core',
    'integrations-openclaw': 'integrations',
    'integrations-claude-code': 'integrations',
    'terraform': 'infrastructure',
    'extension-tests': 'tests',
    'integration-tests': 'tests',
  };

  return { contentType, language, category: categoryMap[source] || source };
}

export function chunkFile(content, relPath, source) {
  const rawLines = content.split('\n');
  if (rawLines.length === 0) return [];

  const metadata = deriveMetadata(relPath, source);
  const lineRecords = normalizeLines(rawLines);

  // Code files use tighter max chunk size
  const isCodeFile = ['python', 'go', 'typescript', 'hcl', 'template'].includes(metadata.language);
  const maxChars = isCodeFile ? 1200 : CHUNK_MAX_CHARS;

  const chunks = [];
  let chunkLines = [];
  let charCount = 0;

  for (let i = 0; i < lineRecords.length; i++) {
    const record = lineRecords[i];
    const line = record.text;
    const lineLen = line.length + 1;

    if (charCount + lineLen > maxChars && chunkLines.length > 0) {
      const isHeading = /^#{1,4}\s/.test(line);
      const isBlank = line.trim() === '';

      let isStrongBoundary = false;
      let isWeakBoundary = isHeading || isBlank;

      if (metadata.language === 'python') {
        const isPythonClass = /^class\s+\w+/.test(line);
        const isPythonFunction = /^(async\s+)?def\s+\w+/.test(line);
        const isPythonDecorated = /^@\w+/.test(line);
        const isPythonMethod = /^\s{4}(async\s+)?def\s+\w+/.test(line);
        isStrongBoundary = isPythonClass || isPythonFunction || isPythonDecorated;
        isWeakBoundary = isWeakBoundary || isPythonMethod;
      } else if (metadata.language === 'go') {
        const isGoFunction = /^func\s+/.test(line);
        const isGoType = /^type\s+\w+\s+(struct|interface)/.test(line);
        isStrongBoundary = isGoFunction || isGoType;
      } else if (metadata.language === 'typescript') {
        const isFunctionDecl = /^(export\s+)?(async\s+)?function\s+\w+/.test(line);
        const isClassDecl = /^(export\s+)?class\s+\w+/.test(line);
        const isTypeDecl = /^(export\s+)?(interface|type|enum)\s+\w+/.test(line);
        const isConstFunc = /^(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(/.test(line);
        isStrongBoundary = isFunctionDecl || isClassDecl || isTypeDecl || isConstFunc;
      } else if (metadata.language === 'hcl') {
        const isTerraformBlock = /^(resource|module|variable|output|provider|data|locals)\s+/.test(line);
        isStrongBoundary = isTerraformBlock;
      }

      const shouldBreak = isStrongBoundary || (!isCodeFile && isWeakBoundary) || charCount > maxChars * 1.2;

      if (shouldBreak) {
        chunks.push(...buildChunks(chunkLines, relPath, source, metadata));
        const { overlapLines } = getOverlap(chunkLines);
        chunkLines = [...overlapLines];
        charCount = chunkLines.reduce((sum, item) => sum + item.text.length + 1, 0);
      }
    }

    chunkLines.push(record);
    charCount += lineLen;
  }

  if (chunkLines.length > 0) {
    chunks.push(...buildChunks(chunkLines, relPath, source, metadata));
  }

  return chunks;
}

function buildChunks(lines, relPath, source, metadata) {
  const chunks = [];
  let currentLines = [];

  for (const line of lines) {
    const candidateLines = [...currentLines, line];
    const candidateText = buildChunkText(
      candidateLines.map(item => item.text),
      relPath,
      candidateLines[0].lineNo,
      candidateLines[candidateLines.length - 1].lineNo
    );

    if (candidateText.length > MAX_EMBEDDING_SAFE_CHARS && currentLines.length > 0) {
      chunks.push(buildChunk(currentLines, relPath, source, metadata));
      currentLines = [line];
    } else {
      currentLines = candidateLines;
    }
  }

  if (currentLines.length > 0) {
    chunks.push(buildChunk(currentLines, relPath, source, metadata));
  }

  return chunks;
}

function buildChunk(lines, relPath, source, metadata) {
  const startLine = lines[0].lineNo;
  const endLine = lines[lines.length - 1].lineNo;
  const text = buildChunkText(lines.map(line => line.text), relPath, startLine, endLine);
  const hash = createHash('sha256').update(text).digest('hex');
  const id = `${hash.slice(0, 12)}-${startLine}`;

  return {
    id, path: relPath, source, startLine, endLine, text, hash,
    contentType: metadata.contentType,
    language: metadata.language,
    category: metadata.category,
  };
}

function buildChunkText(lines, relPath, startLine, endLine) {
  return `// File: ${relPath} (lines ${startLine}-${endLine})\n${lines.join('\n')}`;
}

function getOverlap(chunkLines) {
  let overlapChars = 0;
  let overlapLines = [];

  for (let j = chunkLines.length - 1; j >= 0; j--) {
    overlapChars += chunkLines[j].text.length + 1;
    if (overlapChars > CHUNK_OVERLAP_CHARS) break;
    overlapLines.unshift(chunkLines[j]);
  }

  const overlapStart = overlapLines[0]?.lineNo ?? chunkLines[0]?.lineNo ?? 1;
  return { overlapLines, overlapStart };
}

function normalizeLines(lines) {
  const normalized = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];

    if (line.length <= MAX_LINE_FRAGMENT_CHARS) {
      normalized.push({ text: line, lineNo });
      continue;
    }

    for (let start = 0; start < line.length; start += MAX_LINE_FRAGMENT_CHARS) {
      normalized.push({
        text: line.slice(start, start + MAX_LINE_FRAGMENT_CHARS),
        lineNo,
      });
    }
  }

  return normalized;
}
