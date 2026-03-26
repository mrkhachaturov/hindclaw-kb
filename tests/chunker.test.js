// tests/chunker.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunkFile } from '../lib/chunker.js';

describe('chunker', () => {
  it('chunks Python with class boundaries', () => {
    const content = [
      'class Foo:',
      '    def bar(self):',
      '        pass',
      '',
      'class Baz:',
      '    def qux(self):',
      '        pass',
    ].join('\n');
    const chunks = chunkFile(content, 'hindclaw_ext/models.py', 'extension');
    assert.ok(chunks.length >= 1);
    assert.equal(chunks[0].contentType, 'code');
    assert.equal(chunks[0].language, 'python');
    assert.equal(chunks[0].category, 'core');
  });

  it('chunks Go with func boundaries', () => {
    const content = [
      'package main',
      '',
      'func resourceCreate() {',
      '    // create logic',
      '}',
      '',
      'func resourceRead() {',
      '    // read logic',
      '}',
    ].join('\n');
    const chunks = chunkFile(content, 'provider/resource.go', 'terraform');
    assert.ok(chunks.length >= 1);
    assert.equal(chunks[0].contentType, 'code');
    assert.equal(chunks[0].language, 'go');
    assert.equal(chunks[0].category, 'infrastructure');
  });

  it('chunks Terraform HCL with block boundaries', () => {
    const content = [
      'resource "hindclaw_user" "admin" {',
      '  name  = "admin"',
      '  email = "admin@example.com"',
      '}',
      '',
      'variable "region" {',
      '  type    = string',
      '  default = "us-east-1"',
      '}',
      '',
      'output "user_id" {',
      '  value = hindclaw_user.admin.id',
      '}',
    ].join('\n');
    const chunks = chunkFile(content, 'deploy/main.tf', 'terraform');
    assert.ok(chunks.length >= 1);
    assert.equal(chunks[0].contentType, 'code');
    assert.equal(chunks[0].language, 'hcl');
    assert.equal(chunks[0].category, 'infrastructure');
  });

  it('chunks TypeScript with function boundaries', () => {
    const content = [
      'export async function handleRecall(ctx: Context) {',
      '  return ctx.search();',
      '}',
      '',
      'export function handleRetain(ctx: Context) {',
      '  return ctx.store();',
      '}',
    ].join('\n');
    const chunks = chunkFile(content, 'src/hooks.ts', 'integrations-openclaw');
    assert.ok(chunks.length >= 1);
    assert.equal(chunks[0].contentType, 'code');
    assert.equal(chunks[0].language, 'typescript');
    assert.equal(chunks[0].category, 'integrations');
  });

  it('assigns test content type for phase 2 test sources', () => {
    const content = 'def test_something():\n    assert True\n';
    const chunks = chunkFile(content, 'tests/test_auth.py', 'extension-tests');
    assert.ok(chunks.length >= 1);
    assert.equal(chunks[0].contentType, 'test');
  });

  it('assigns template language for .tpl files', () => {
    const content = '{{ .Values.name }}\n{{ range .Items }}\n{{ end }}\n';
    const chunks = chunkFile(content, 'templates/user.tpl', 'terraform');
    assert.ok(chunks.length >= 1);
    assert.equal(chunks[0].language, 'template');
  });

  it('generates unique chunk IDs', () => {
    const content = 'func main() {\n  fmt.Println("hello")\n}\n';
    const chunks = chunkFile(content, 'main.go', 'terraform');
    for (const chunk of chunks) {
      assert.ok(chunk.id, 'Chunk must have an ID');
      assert.ok(chunk.hash, 'Chunk must have a hash');
      assert.ok(chunk.id.includes('-'), 'ID format: hash-lineNo');
    }
  });
});
