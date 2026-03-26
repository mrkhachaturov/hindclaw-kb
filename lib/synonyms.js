const SYNONYMS = {
  'tenant': ['extension', 'workspace', 'namespace'],
  'extension': ['tenant', 'server extension', 'plugin'],
  'policy': ['auth', 'authorization', 'access control', 'permission'],
  'validator': ['validation', 'guard', 'policy check', 'access control'],
  'sync': ['synchronization', 'mirror', 'reconcile'],
  'bank': ['memory bank', 'domain', 'namespace'],
  'recall': ['retrieve', 'search memory', 'query memory'],
  'retain': ['store', 'ingest', 'save memory'],
  'directive': ['instruction', 'system prompt'],
  'terraform': ['provider', 'resource', 'module', 'state', 'infrastructure'],
  'provider': ['terraform provider', 'resource provider'],
  'resource': ['terraform resource', 'managed resource'],
  'module': ['terraform module'],
  'openclaw': ['integration', 'plugin', 'gateway'],
  'claude': ['claude code', 'integration', 'plugin'],
  'hook': ['lifecycle hook', 'event handler', 'callback'],
  'config': ['configuration', 'settings', 'options'],
  'auth': ['authentication', 'authorization', 'access'],
  'api': ['endpoint', 'route', 'handler'],
  'client': ['sdk', 'library', 'wrapper'],
  'entity': ['user', 'group', 'identity', 'principal'],
  'label': ['entity label', 'tag', 'annotation'],
  'strategy': ['retain strategy', 'extraction', 'pattern'],
  'mcp': ['model context protocol', 'tool server'],
  'webhook': ['event', 'notification', 'callback'],
  'reflect': ['analyze', 'mental model', 'introspect'],
  'observation': ['fact', 'note', 'insight'],
};

/**
 * Expand a query with synonyms for better recall.
 * @param {string} query
 * @returns {string}
 */
export function expandQuery(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const expanded = new Set(words);

  for (const word of words) {
    const synonyms = SYNONYMS[word];
    if (synonyms) {
      for (const syn of synonyms) {
        expanded.add(syn);
      }
    }
  }

  return [...expanded].join(' ');
}
