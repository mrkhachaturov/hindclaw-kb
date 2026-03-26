// tests/query.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatJsonOutput } from '../commands/query.js';

describe('query', () => {
  it('formatJsonOutput includes component in results', () => {
    const results = [{
      score: 0.95, path: 'hindclaw_ext/models.py', startLine: 1, endLine: 10,
      source: 'extension', component: 'hindclaw', contentType: 'code',
      language: 'python', category: 'core', text: 'class Foo:\n  pass',
    }];
    const json = JSON.parse(formatJsonOutput('test query', results));
    assert.equal(json.query, 'test query');
    assert.equal(json.results.length, 1);
    assert.equal(json.results[0].component, 'hindclaw');
    assert.equal(json.results[0].source, 'extension');
  });

  it('formatJsonOutput includes relatedCode when provided', () => {
    const results = [{ score: 0.9, path: 'a.py', startLine: 1, endLine: 5, source: 'extension',
      component: 'hindclaw', contentType: 'code', language: 'python', category: 'core', text: 'x' }];
    const code = [{ score: 0.8, path: 'b.py', startLine: 1, endLine: 5, source: 'extension-tests',
      component: 'hindclaw', contentType: 'test', language: 'python', category: 'tests', text: 'y' }];
    const json = JSON.parse(formatJsonOutput('q', results, code));
    assert.ok(json.relatedCode);
    assert.equal(json.relatedCode.length, 1);
  });
});
