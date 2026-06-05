import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../src/parser.js';
import importExtractor from '../../src/extractors/core/imports.js';
import extractor from '../../src/extractors/core/inheritance.js';

async function extract(php, filePath = '/test.php') {
  const tree = await parse(php, 'php');
  const context = { importMap: new Map() };
  const ir = importExtractor.extract(filePath, php, tree, context);
  for (const imp of (ir.imports || [])) {
    context.importMap.set(`${filePath}::${imp.alias}`, imp.qualified_name);
  }
  return extractor.extract(filePath, php, tree, context);
}

describe('inheritance extractor', () => {
  it('extracts extends', async () => {
    const { edges } = await extract('<?php namespace App; class Child extends Parent {}');
    const ext = edges.find(e => e.type === 'EXTENDS');
    assert.equal(ext.source, 'App\\Child');
    assert.equal(ext.target, 'App\\Parent');
  });

  it('extracts implements', async () => {
    const { edges } = await extract('<?php namespace App; class Foo implements Bar, Baz {}');
    const impls = edges.filter(e => e.type === 'IMPLEMENTS');
    assert.equal(impls.length, 2);
    assert.equal(impls[0].target, 'App\\Bar');
    assert.equal(impls[1].target, 'App\\Baz');
  });

  it('extracts trait use', async () => {
    const { edges } = await extract('<?php namespace App; class Foo { use SomeTrait; }');
    const trait = edges.find(e => e.type === 'USES_TRAIT');
    assert.equal(trait.source, 'App\\Foo');
    assert.equal(trait.target, 'App\\SomeTrait');
  });

  it('resolves imported class names', async () => {
    const { edges } = await extract('<?php namespace App\\Services; use App\\Models\\BaseModel; class MyService extends BaseModel {}');
    const ext = edges.find(e => e.type === 'EXTENDS');
    assert.equal(ext.target, 'App\\Models\\BaseModel');
  });

  it('handles fully qualified names', async () => {
    const { edges } = await extract('<?php namespace App; class Foo extends \\Some\\External\\Base {}');
    const ext = edges.find(e => e.type === 'EXTENDS');
    assert.equal(ext.target, 'Some\\External\\Base');
  });

  it('extracts interface extends', async () => {
    const { edges } = await extract('<?php namespace App; interface Child extends Parent {}');
    const ext = edges.find(e => e.type === 'EXTENDS');
    assert.equal(ext.source, 'App\\Child');
    assert.equal(ext.target, 'App\\Parent');
  });
});
