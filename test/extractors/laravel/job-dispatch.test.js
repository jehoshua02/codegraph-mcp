import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../../src/parser.js';
import importExtractor from '../../../src/extractors/plugins/php/imports.js';
import extractor from '../../../src/extractors/plugins/laravel/job-dispatch.js';

async function extract(php, filePath = '/test.php') {
  const tree = await parse(php, 'php');
  const context = { importMap: new Map() };
  const ir = importExtractor.extract(filePath, php, tree, context);
  for (const imp of (ir.imports || [])) {
    context.importMap.set(`${filePath}::${imp.alias}`, imp.qualified_name);
  }
  return extractor.extract(filePath, php, tree, context);
}

describe('laravel job dispatch extractor', () => {
  it('detects FooJob::dispatch()', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Services;
      use App\\Jobs\\SendEmailJob;
      class Foo {
        public function bar() { SendEmailJob::dispatch('test@example.com'); }
      }
    `);
    assert.ok(edges.length > 0);
    assert.ok(edges.some(e => e.type === 'DISPATCHES_JOB' && e.target.includes('SendEmailJob::handle')));
    assert.ok(edges.some(e => e.target.includes('SendEmailJob::_handle')));
    assert.equal(edges[0].source, 'App\\Services\\Foo::bar');
    assert.equal(edges[0].metadata.pattern, 'static');
    assert.equal(edges[0].metadata.job, 'App\\Jobs\\SendEmailJob');
  });

  it('detects dispatch(new FooJob(...))', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Services;
      use App\\Jobs\\SendEmailJob;
      class Foo {
        public function bar() { dispatch(new SendEmailJob('test@example.com')); }
      }
    `);
    assert.ok(edges.length > 0);
    assert.ok(edges.some(e => e.type === 'DISPATCHES_JOB' && e.target.includes('SendEmailJob::handle')));
    assert.equal(edges[0].metadata.pattern, 'helper');
  });

  it('detects Bus::dispatch(new FooJob(...))', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Services;
      use App\\Jobs\\SendEmailJob;
      class Foo {
        public function bar() { Bus::dispatch(new SendEmailJob()); }
      }
    `);
    assert.ok(edges.length > 0);
    assert.ok(edges.some(e => e.type === 'DISPATCHES_JOB' && e.target.includes('SendEmailJob::handle')));
    assert.equal(edges[0].metadata.pattern, 'bus');
  });

  it('ignores non-dispatch static calls', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Services;
      use App\\Jobs\\SendEmailJob;
      class Foo {
        public function bar() { SendEmailJob::find(1); }
      }
    `);
    const dispatchEdges = edges.filter(e => e.type === 'DISPATCHES_JOB');
    assert.equal(dispatchEdges.length, 0);
  });

  it('ignores dispatch of non-job function calls', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Services;
      class Foo {
        public function bar() { dispatch('some-string'); }
      }
    `);
    const dispatchEdges = edges.filter(e => e.type === 'DISPATCHES_JOB');
    assert.equal(dispatchEdges.length, 0);
  });

  it('resolves fully qualified job names', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Services;
      class Foo {
        public function bar() { \\App\\Jobs\\MyJob::dispatch(); }
      }
    `);
    assert.ok(edges.some(e => e.metadata.job === 'App\\Jobs\\MyJob'));
  });
});
