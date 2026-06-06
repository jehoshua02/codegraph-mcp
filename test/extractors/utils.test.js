import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../src/parser.js';
import { extractNamespace, qualify, resolveClassName, isPrimitiveType, extractVisibility, hasModifier, extractParams } from '../../src/extractors/plugins/php/utils.js';

describe('qualify', () => {
  it('qualifies with namespace', () => {
    assert.equal(qualify('App\\Models', 'User'), 'App\\Models\\User');
  });

  it('returns name when no namespace', () => {
    assert.equal(qualify('', 'User'), 'User');
  });
});

describe('resolveClassName', () => {
  it('strips leading backslash from FQN', () => {
    assert.equal(resolveClassName('\\App\\Models\\User', 'Other', {}, '/f.php'), 'App\\Models\\User');
  });

  it('resolves via import map', () => {
    const context = { importMap: new Map([['/f.php::User', 'App\\Models\\User']]) };
    assert.equal(resolveClassName('User', 'Other', context, '/f.php'), 'App\\Models\\User');
  });

  it('falls back to namespace qualification', () => {
    assert.equal(resolveClassName('User', 'App\\Services', {}, '/f.php'), 'App\\Services\\User');
  });

  it('handles no context', () => {
    assert.equal(resolveClassName('User', 'App', null, '/f.php'), 'App\\User');
  });
});

describe('isPrimitiveType', () => {
  it('recognizes primitives', () => {
    for (const t of ['string', 'int', 'float', 'bool', 'array', 'void', 'mixed', 'null', 'callable', 'iterable', 'never']) {
      assert.equal(isPrimitiveType(t), true, `${t} should be primitive`);
    }
  });

  it('is case-insensitive', () => {
    assert.equal(isPrimitiveType('String'), true);
    assert.equal(isPrimitiveType('INT'), true);
  });

  it('rejects class names', () => {
    assert.equal(isPrimitiveType('User'), false);
    assert.equal(isPrimitiveType('Collection'), false);
  });
});

describe('extractNamespace', async () => {
  it('extracts namespace from PHP', async () => {
    const tree = await parse('<?php namespace App\\Models;', 'php');
    assert.equal(extractNamespace(tree.rootNode), 'App\\Models');
  });

  it('returns empty string when no namespace', async () => {
    const tree = await parse('<?php class Foo {}', 'php');
    assert.equal(extractNamespace(tree.rootNode), '');
  });
});

describe('extractVisibility', async () => {
  it('extracts public', async () => {
    const tree = await parse('<?php class Foo { public function bar() {} }', 'php');
    const method = findNode(tree.rootNode, 'method_declaration');
    assert.equal(extractVisibility(method), 'public');
  });

  it('extracts private', async () => {
    const tree = await parse('<?php class Foo { private function bar() {} }', 'php');
    const method = findNode(tree.rootNode, 'method_declaration');
    assert.equal(extractVisibility(method), 'private');
  });

  it('defaults to public', async () => {
    const tree = await parse('<?php class Foo { function bar() {} }', 'php');
    const method = findNode(tree.rootNode, 'method_declaration');
    assert.equal(extractVisibility(method), 'public');
  });
});

describe('hasModifier', async () => {
  it('detects static', async () => {
    const tree = await parse('<?php class Foo { public static function bar() {} }', 'php');
    const method = findNode(tree.rootNode, 'method_declaration');
    assert.equal(hasModifier(method, 'static'), true);
  });

  it('returns false when not static', async () => {
    const tree = await parse('<?php class Foo { public function bar() {} }', 'php');
    const method = findNode(tree.rootNode, 'method_declaration');
    assert.equal(hasModifier(method, 'static'), false);
  });
});

describe('extractParams', async () => {
  it('extracts typed params', async () => {
    const tree = await parse('<?php function foo(string $name, int $age) {}', 'php');
    const fn = findNode(tree.rootNode, 'function_definition');
    const params = extractParams(fn);
    assert.equal(params.length, 2);
    assert.equal(params[0].name, 'name');
    assert.equal(params[0].type, 'string');
    assert.equal(params[1].name, 'age');
    assert.equal(params[1].type, 'int');
  });

  it('handles no params', async () => {
    const tree = await parse('<?php function foo() {}', 'php');
    const fn = findNode(tree.rootNode, 'function_definition');
    assert.deepEqual(extractParams(fn), []);
  });

  it('handles untyped params', async () => {
    const tree = await parse('<?php function foo($x) {}', 'php');
    const fn = findNode(tree.rootNode, 'function_definition');
    const params = extractParams(fn);
    assert.equal(params[0].type, null);
  });
});

function findNode(node, type) {
  if (node.type === type) return node;
  for (let i = 0; i < node.childCount; i++) {
    const result = findNode(node.child(i), type);
    if (result) return result;
  }
  return null;
}
