import { openDb, closeDb, getLatestVersions } from '../lib/db.js';
import { EXIT_SUCCESS, EXIT_RUNTIME_ERROR, EXIT_NO_RESULTS } from '../lib/exit-codes.js';

export function register(program) {
  program
    .command('latest')
    .description('Show latest indexed version per component')
    .action(() => handler());
}

export function handler() {
  try {
    openDb();
    const versions = getLatestVersions();

    if (versions.length === 0) {
      console.log('No components indexed yet. Run: hindclaw-kb index');
      closeDb();
      process.exit(EXIT_NO_RESULTS);
    }

    console.log('Latest indexed versions:\n');
    for (const v of versions) {
      const date = new Date(v.indexed_at).toISOString().slice(0, 19);
      console.log(`  ${v.component}: ${v.tag} (${v.commit_hash}) — indexed ${date}`);
    }

    closeDb();
    process.exit(EXIT_SUCCESS);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(EXIT_RUNTIME_ERROR);
  }
}
