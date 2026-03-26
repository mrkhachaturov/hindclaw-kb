import { openDb, closeDb, getChunksSinceComponentVersion } from '../lib/db.js';
import { EXIT_SUCCESS, EXIT_RUNTIME_ERROR, EXIT_NO_RESULTS } from '../lib/exit-codes.js';

export function register(program) {
  program
    .command('since <component> <version>')
    .description('Show chunks indexed since a component version')
    .action((component, version) => handler({ component, version }));
}

export function handler({ component, version }) {
  try {
    openDb();
    const chunks = getChunksSinceComponentVersion(component, version);

    if (chunks.length === 0) {
      console.log(`No chunks found for ${component} since ${version}`);
      closeDb();
      process.exit(EXIT_NO_RESULTS);
    }

    console.log(`Chunks for ${component} since ${version}:\n`);
    const bySource = {};
    for (const c of chunks) {
      if (!bySource[c.source]) bySource[c.source] = [];
      bySource[c.source].push(c);
    }
    for (const [source, sourceChunks] of Object.entries(bySource)) {
      console.log(`\n${source}: ${sourceChunks.length} chunks`);
      for (const c of sourceChunks.slice(0, 5)) {
        console.log(`  - ${c.path}:${c.startLine}-${c.endLine}`);
      }
      if (sourceChunks.length > 5) {
        console.log(`  ... and ${sourceChunks.length - 5} more`);
      }
    }

    closeDb();
    process.exit(EXIT_SUCCESS);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(EXIT_RUNTIME_ERROR);
  }
}
