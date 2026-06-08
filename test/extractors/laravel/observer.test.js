import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../../src/parser.js';
import importExtractor from '../../../src/extractors/plugins/php/imports.js';
import extractor from '../../../src/extractors/plugins/laravel/observer.js';

async function extract(php, filePath = '/test.php') {
  const tree = await parse(php, 'php');
  const context = { importMap: new Map() };
  const ir = importExtractor.extract(filePath, php, tree, context);
  for (const imp of (ir.imports || [])) {
    context.importMap.set(`${filePath}::${imp.alias}`, imp.qualified_name);
  }
  return extractor.extract(filePath, php, tree, context);
}

describe('laravel observer extractor', () => {
  it('detects Model::observe(Observer::class)', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Providers;
      use App\\Models\\User;
      use App\\Observers\\UserObserver;
      class EventServiceProvider {
        public function boot() { User::observe(UserObserver::class); }
      }
    `);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].type, 'OBSERVES');
    assert.equal(edges[0].source, 'App\\Observers\\UserObserver');
    assert.equal(edges[0].target, 'App\\Models\\User');
  });

  it('detects static::observe(new Observer)', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      use App\\Observers\\UserObserver;
      class User extends Model {
        protected static function boot() { static::observe(new UserObserver); }
      }
    `);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].source, 'App\\Observers\\UserObserver');
    assert.equal(edges[0].target, 'App\\Models\\User');
  });

  it('detects static::observe(new Observer())', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      use App\\Observers\\UserObserver;
      class User extends Model {
        protected static function boot() { static::observe(new UserObserver()); }
      }
    `);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].source, 'App\\Observers\\UserObserver');
    assert.equal(edges[0].target, 'App\\Models\\User');
  });

  it('detects static::observe(App::make(Observer::class))', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      use App\\Observers\\NoteObserver;
      class Note extends Model {
        protected static function boot() { static::observe(App::make(NoteObserver::class)); }
      }
    `);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].source, 'App\\Observers\\NoteObserver');
    assert.equal(edges[0].target, 'App\\Models\\Note');
  });

  it('ignores non-observe calls', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class User extends Model {
        protected static function boot() { static::creating(function() {}); }
      }
    `);
    assert.equal(edges.length, 0);
  });

  it('ignores files without observe calls', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Services;
      class UserService {}
    `);
    assert.equal(edges.length, 0);
  });
});
