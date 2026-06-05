import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../src/parser.js';
import extractor from '../../src/extractors/core/imports.js';

async function extract(php) {
  const tree = await parse(php, 'php');
  const context = { importMap: new Map() };
  return extractor.extract('/test.php', php, tree, context);
}

describe('import extractor', () => {
  it('extracts simple use statement', async () => {
    const result = await extract('<?php use App\\Models\\User;');
    assert.equal(result.imports.length, 1);
    assert.equal(result.imports[0].qualified_name, 'App\\Models\\User');
    assert.equal(result.imports[0].alias, 'User');
  });

  it('extracts aliased use statement', async () => {
    const result = await extract('<?php use App\\Models\\User as UserModel;');
    assert.equal(result.imports[0].qualified_name, 'App\\Models\\User');
    assert.equal(result.imports[0].alias, 'UserModel');
  });

  it('extracts grouped use statement', async () => {
    const result = await extract('<?php use App\\Models\\{User, Post, Comment};');
    assert.equal(result.imports.length, 3);
    const names = result.imports.map(i => i.qualified_name);
    assert.ok(names.includes('App\\Models\\User'));
    assert.ok(names.includes('App\\Models\\Post'));
    assert.ok(names.includes('App\\Models\\Comment'));
  });

  it('creates IMPORTS edges', async () => {
    const result = await extract('<?php use App\\Models\\User;');
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].source, '/test.php');
    assert.equal(result.edges[0].target, 'App\\Models\\User');
    assert.equal(result.edges[0].type, 'IMPORTS');
  });

  it('extracts multiple use statements', async () => {
    const result = await extract('<?php use App\\Models\\User; use App\\Services\\UserService;');
    assert.equal(result.imports.length, 2);
  });

  it('handles namespace with use statements', async () => {
    const result = await extract('<?php namespace App\\Services; use App\\Models\\User;');
    assert.equal(result.imports.length, 1);
    assert.equal(result.imports[0].qualified_name, 'App\\Models\\User');
  });
});
