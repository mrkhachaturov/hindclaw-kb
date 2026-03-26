import { openDb, closeDb, getIndexHistory } from '../lib/db.js';
import { EXIT_SUCCESS, EXIT_RUNTIME_ERROR, EXIT_NO_RESULTS } from '../lib/exit-codes.js';

export function register(program) {
  program
    .command('history')
    .description('Show last 10 index runs with component versions')
    .action(() => handler());
}

export function handler() {
  try {
    openDb();
    const history = getIndexHistory(10);

    if (history.length === 0) {
      console.log('No index runs yet. Run: hindclaw-kb index');
      closeDb();
      process.exit(EXIT_NO_RESULTS);
    }

    console.log('Index history:\n');
    for (const run of history) {
      const date = new Date(run.indexedAt).toISOString().slice(0, 19);
      const components = run.components.map(c => `${c.component}@${c.tag}`).join(', ');
      console.log(`  Run #${run.runId} (${date}): ${components || 'no versions recorded'}`);
    }

    closeDb();
    process.exit(EXIT_SUCCESS);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(EXIT_RUNTIME_ERROR);
  }
}
