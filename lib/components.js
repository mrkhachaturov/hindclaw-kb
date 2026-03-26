import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { COMPONENTS } from './config.js';

/**
 * Resolve the current version of a component from its git context.
 * For submodules, runs git inside the submodule directory.
 * @param {{ name: string, path: string, tagPattern: RegExp }} component
 * @param {string} rootDir - Hindclaw root directory
 * @returns {{ tag: string|null, commitHash: string|null }}
 */
export function resolveComponentVersion(component, rootDir) {
  const componentDir = join(rootDir, component.path);

  if (!existsSync(componentDir)) {
    return { tag: null, commitHash: null };
  }

  const hash = gitShortHash(componentDir);

  // List all tags reachable from HEAD, filter by component's pattern, pick latest
  const listResult = spawnSync('git', [
    'tag', '-l', '--sort=-version:refname', '--merged', 'HEAD',
  ], {
    cwd: componentDir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (listResult.status === 0) {
    const tags = listResult.stdout.trim().split('\n').filter(Boolean);
    const matchingTag = tags.find(t => component.tagPattern.test(t));
    if (matchingTag) {
      return { tag: matchingTag, commitHash: hash };
    }
  }

  // Fallback to short commit SHA
  return { tag: hash, commitHash: hash };
}

/**
 * Resolve versions for all components.
 * @param {string} rootDir
 * @returns {Map<string, { tag: string|null, commitHash: string|null }>}
 */
export function resolveAllVersions(rootDir) {
  const versions = new Map();
  for (const comp of COMPONENTS) {
    versions.set(comp.name, resolveComponentVersion(comp, rootDir));
  }
  return versions;
}

/**
 * Find which component a file path belongs to.
 * Matches the longest component path prefix.
 * @param {string} relPath - Relative path from hindclaw root
 * @returns {{ name: string, path: string, tagPattern: RegExp }}
 */
export function getComponentForPath(relPath) {
  // Sort by path length descending so longer (more specific) paths match first
  const sorted = [...COMPONENTS]
    .filter(c => c.path !== '.')
    .sort((a, b) => b.path.length - a.path.length);

  for (const comp of sorted) {
    if (relPath.startsWith(comp.path + '/') || relPath === comp.path) {
      return comp;
    }
  }

  // Default to core repo
  return COMPONENTS.find(c => c.path === '.');
}

function gitShortHash(cwd) {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? result.stdout.trim() : null;
}
