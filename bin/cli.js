#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

const program = new Command();
program
  .name('hindclaw-kb')
  .description('Product-wide code-first knowledge base for Hindclaw')
  .version(pkg.version);

// Register commands
import { register as registerStats } from '../commands/stats.js';
import { register as registerLatest } from '../commands/latest.js';
import { register as registerHistory } from '../commands/history.js';
import { register as registerSince } from '../commands/since.js';
import { register as registerQuery } from '../commands/query.js';
import { registerCode, registerExtension, registerIntegrations, registerTerraform, registerVerify } from '../commands/aliases.js';
import { register as registerIndex } from '../commands/index.js';
import { register as registerMcpServe } from '../commands/mcp-serve.js';

registerStats(program);
registerLatest(program);
registerHistory(program);
registerSince(program);
registerQuery(program);
registerCode(program);
registerExtension(program);
registerIntegrations(program);
registerTerraform(program);
registerVerify(program);
registerIndex(program);
registerMcpServe(program);

program.parse();
