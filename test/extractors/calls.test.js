import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../src/parser.js';
import importExtractor from '../../src/extractors/plugins/php/imports.js';
import extractor from '../../src/extractors/plugins/php/calls.js';

async function extract(php, filePath = '/test.php') {
  const tree = await parse(php, 'php');
  const context = { importMap: new Map() };
  const ir = importExtractor.extract(filePath, php, tree, context);
  for (const imp of (ir.imports || [])) {
    context.importMap.set(`${filePath}::${imp.alias}`, imp.qualified_name);
  }
  return extractor.extract(filePath, php, tree, context);
}

describe('call extractor', () => {
  it('extracts $this-> calls', async () => {
    const { edges } = await extract('<?php namespace App; class Foo { public function bar() { $this->baz(); } public function baz() {} }');
    const call = edges.find(e => e.type === 'CALLS');
    assert.equal(call.source, 'App\\Foo::bar');
    assert.equal(call.target, 'App\\Foo::baz');
  });

  it('extracts static calls', async () => {
    const { edges } = await extract('<?php namespace App; use App\\Models\\User; class Foo { public function bar() { User::find(1); } }');
    const call = edges.find(e => e.target.includes('User'));
    assert.equal(call.source, 'App\\Foo::bar');
    assert.equal(call.target, 'App\\Models\\User::find');
  });

  it('extracts self:: calls', async () => {
    const { edges } = await extract('<?php namespace App; class Foo { public function bar() { self::create(); } public static function create() {} }');
    const call = edges.find(e => e.type === 'CALLS');
    assert.equal(call.source, 'App\\Foo::bar');
    assert.equal(call.target, 'App\\Foo::create');
  });

  it('extracts static:: calls', async () => {
    const { edges } = await extract('<?php namespace App; class Foo { public function bar() { static::create(); } public static function create() {} }');
    const call = edges.find(e => e.type === 'CALLS');
    assert.equal(call.target, 'App\\Foo::create');
  });

  it('extracts parent:: calls', async () => {
    const { edges } = await extract('<?php namespace App; class Child extends Base { public function bar() { parent::boot(); } }');
    const call = edges.find(e => e.type === 'CALLS');
    assert.equal(call.source, 'App\\Child::bar');
    assert.equal(call.target, 'App\\Base::boot');
  });

  it('extracts new ClassName() as CALLS to __construct', async () => {
    const { edges } = await extract('<?php namespace App; use App\\Models\\User; class Foo { public function bar() { new User(); } }');
    const call = edges.find(e => e.target.includes('__construct'));
    assert.equal(call.target, 'App\\Models\\User::__construct');
  });

  it('resolves typed parameter calls', async () => {
    const { edges } = await extract('<?php namespace App; use App\\Models\\User; class Foo { public function bar(User $user) { $user->save(); } }');
    const call = edges.find(e => e.target.includes('User'));
    assert.equal(call.target, 'App\\Models\\User::save');
  });

  it('resolves constructor-promoted property calls', async () => {
    const { edges } = await extract('<?php namespace App; use App\\Repositories\\UserRepo; class Svc { public function __construct(private readonly UserRepo $repo) {} public function get() { $this->repo->find(); } }');
    const call = edges.find(e => e.target.includes('UserRepo'));
    assert.equal(call.target, 'App\\Repositories\\UserRepo::find');
  });

  it('extracts function calls', async () => {
    const { edges } = await extract('<?php namespace App; function foo() { bar(); } function bar() {}');
    const call = edges.find(e => e.type === 'CALLS');
    assert.equal(call.source, 'App\\foo');
    assert.equal(call.target, 'App\\bar');
  });

  it('ignores primitive-typed parameters', async () => {
    const { edges } = await extract('<?php namespace App; class Foo { public function bar(string $name) { $name->something(); } }');
    const call = edges.find(e => e.target.includes('string'));
    assert.equal(call, undefined);
  });

  it('handles nullable type hints', async () => {
    const { edges } = await extract('<?php namespace App; use App\\Models\\User; class Foo { public function bar(?User $user) { $user->save(); } }');
    const call = edges.find(e => e.target.includes('User'));
    assert.equal(call.target, 'App\\Models\\User::save');
  });
});
