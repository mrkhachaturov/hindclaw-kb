import { openDb, closeDb, getStats } from '../lib/db.js';
import { EXIT_SUCCESS, EXIT_RUNTIME_ERROR } from '../lib/exit-codes.js';

export function register(program) {
  program
    .command('stats')
    .description('Show database statistics')
    .action(() => handler());
}

export function handler() {
  try {
    openDb();
    const stats = getStats();
    console.log(JSON.stringify(stats, null, 2));
    closeDb();
    process.exit(EXIT_SUCCESS);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(EXIT_RUNTIME_ERROR);
  }
}
