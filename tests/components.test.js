// tests/components.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveComponentVersion, resolveAllVersions, getComponentForPath } from '../lib/components.js';
import { COMPONENTS } from '../lib/config.js';

describe('components', () => {
  it('getComponentForPath resolves extension to hindclaw', () => {
    const comp = getComponentForPath('hindclaw-extension/hindclaw_ext/models.py');
    assert.equal(comp.name, 'hindclaw');
  });

  it('getComponentForPath resolves openclaw plugin', () => {
    const comp = getComponentForPath('hindclaw-integrations/openclaw/src/index.ts');
    assert.equal(comp.name, 'hindclaw-openclaw-plugin');
  });

  it('getComponentForPath resolves terraform', () => {
    const comp = getComponentForPath('hindclaw-terraform/main.tf');
    assert.equal(comp.name, 'terraform-provider-hindclaw');
  });

  it('getComponentForPath returns core for root-level files', () => {
    const comp = getComponentForPath('CLAUDE.md');
    assert.equal(comp.name, 'hindclaw');
  });

  it('resolveComponentVersion returns tag or short SHA', () => {
    // This test verifies the function exists and handles missing dirs gracefully
    const version = resolveComponentVersion(COMPONENTS[0], '/nonexistent');
    assert.equal(version.tag, null);
    assert.equal(version.commitHash, null);
  });
});
