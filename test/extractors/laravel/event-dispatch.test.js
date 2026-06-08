import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../../src/parser.js';
import importExtractor from '../../../src/extractors/plugins/php/imports.js';
import extractor from '../../../src/extractors/plugins/laravel/event-dispatch.js';

async function extract(php, filePath = '/test.php') {
  const tree = await parse(php, 'php');
  const context = { importMap: new Map() };
  const ir = importExtractor.extract(filePath, php, tree, context);
  for (const imp of (ir.imports || [])) {
    context.importMap.set(`${filePath}::${imp.alias}`, imp.qualified_name);
  }
  return extractor.extract(filePath, php, tree, context);
}

describe('laravel event dispatch extractor', () => {
  it('detects event(new FooEvent(...))', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Services;
      use App\\Events\\UserRegistered;
      class Foo {
        public function bar() { event(new UserRegistered()); }
      }
    `);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].type, 'DISPATCHES_EVENT');
    assert.equal(edges[0].target, 'App\\Events\\UserRegistered');
    assert.equal(edges[0].source, 'App\\Services\\Foo::bar');
    assert.equal(edges[0].metadata.pattern, 'helper');
  });

  it('detects FooEvent::dispatch()', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Services;
      use App\\Events\\UserRegistered;
      class Foo {
        public function bar() { UserRegistered::dispatch(); }
      }
    `);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].target, 'App\\Events\\UserRegistered');
    assert.equal(edges[0].metadata.pattern, 'static');
  });

  it('detects Event::dispatch(new FooEvent(...))', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Services;
      use App\\Events\\UserRegistered;
      class Foo {
        public function bar() { Event::dispatch(new UserRegistered()); }
      }
    `);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].target, 'App\\Events\\UserRegistered');
    assert.equal(edges[0].metadata.pattern, 'facade');
  });

  it('ignores non-event function calls', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Services;
      class Foo {
        public function bar() { dispatch(new SomeJob()); }
      }
    `);
    assert.equal(edges.length, 0);
  });

  it('ignores event() without new expression', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Services;
      class Foo {
        public function bar() { event('some-string'); }
      }
    `);
    assert.equal(edges.length, 0);
  });
});
