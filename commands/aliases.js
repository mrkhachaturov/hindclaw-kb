import { handler as queryHandler } from './query.js';

function makeAlias(name, description, filterOpts) {
  return function register(program) {
    program
      .command(`${name} <text...>`)
      .description(description)
      .option('--json', 'Output JSON')
      .option('--top <n>', 'Number of results', '8')
      .option('--offline', 'FTS-only keyword search')
      .action(async (textParts, opts) => {
        await queryHandler({ query: textParts.join(' '), ...filterOpts, ...opts });
      });
  };
}

export const registerCode = makeAlias('code', 'Search all Hindclaw code sources', {});
export const registerExtension = makeAlias('extension', 'Search extension code only', { extension: true });
export const registerIntegrations = makeAlias('integrations', 'Search integration code only', { integrations: true });
export const registerTerraform = makeAlias('terraform', 'Search Terraform/provider code only', { terraform: true });
export const registerVerify = makeAlias('verify', 'Code + related tests (two-pass)', { verify: true });
