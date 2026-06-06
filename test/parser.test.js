import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse, languageForFile } from '../src/parser.js';

describe('languageForFile', () => {
  it('returns php for .php files', () => {
    assert.equal(languageForFile('app/Models/User.php'), 'php');
  });

  it('returns null for unsupported files', () => {
    assert.equal(languageForFile('app.js'), null);
    assert.equal(languageForFile('style.css'), null);
    assert.equal(languageForFile('README.md'), null);
  });
});

describe('parse', () => {
  it('parses PHP into AST', async () => {
    const tree = await parse('<?php class Foo {}', 'php');
    assert.equal(tree.rootNode.type, 'program');
    assert.ok(tree.rootNode.childCount > 0);
  });

  it('parses large PHP files', async () => {
    const content = '<?php\n' + Array(1000).fill('function f() {}').join('\n');
    const tree = await parse(content, 'php');
    assert.equal(tree.rootNode.type, 'program');
  });

  it('throws for unsupported language', async () => {
    await assert.rejects(() => parse('const x = 1;', 'ruby'), /Unsupported language/);
  });
});
