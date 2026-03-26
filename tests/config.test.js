// tests/config.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, COMPONENTS, getActiveSources, getExtraSources } from '../lib/config.js';

describe('config', () => {
  it('all phase 1 sources have no phase property', () => {
    const phase1 = SOURCES.filter(s => !s.phase);
    assert.ok(phase1.length >= 4, `Expected at least 4 phase 1 sources, got ${phase1.length}`);
    for (const s of phase1) {
      assert.ok(s.name, 'Source must have a name');
      assert.ok(s.component, 'Source must have a component');
      assert.ok(s.globs.length > 0, `Source ${s.name} must have globs`);
    }
  });

  it('phase 2 sources have phase: 2', () => {
    const phase2 = SOURCES.filter(s => s.phase === 2);
    assert.ok(phase2.length >= 2);
    for (const s of phase2) {
      assert.ok(s.name);
    }
  });

  it('every source maps to a known component', () => {
    const componentNames = COMPONENTS.map(c => c.name);
    for (const s of SOURCES) {
      if (s.component) {
        assert.ok(componentNames.includes(s.component),
          `Source ${s.name} references unknown component ${s.component}`);
      }
    }
  });

  it('getActiveSources returns only phase 1 by default', () => {
    const active = getActiveSources([]);
    assert.ok(active.every(s => !s.phase), 'Should only return phase 1 sources');
    assert.equal(active.length, SOURCES.filter(s => !s.phase).length);
  });

  it('getActiveSources includes named phase 2 sources', () => {
    const active = getActiveSources(['extension-tests']);
    const names = active.map(s => s.name);
    assert.ok(names.includes('extension-tests'));
    assert.ok(names.includes('extension')); // phase 1 still included
  });

  it('COMPONENTS has 4 entries', () => {
    assert.equal(COMPONENTS.length, 4);
    const names = COMPONENTS.map(c => c.name);
    assert.ok(names.includes('hindclaw'));
    assert.ok(names.includes('hindclaw-openclaw-plugin'));
    assert.ok(names.includes('hindclaw-claude-plugin'));
    assert.ok(names.includes('terraform-provider-hindclaw'));
  });
});
