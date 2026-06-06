import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../../src/parser.js';
import importExtractor from '../../../src/extractors/plugins/php/imports.js';
import extractor from '../../../src/extractors/plugins/laravel/eloquent-relationship.js';

async function extract(php, filePath = '/test.php') {
  const tree = await parse(php, 'php');
  const context = { importMap: new Map() };
  const ir = importExtractor.extract(filePath, php, tree, context);
  for (const imp of (ir.imports || [])) {
    context.importMap.set(`${filePath}::${imp.alias}`, imp.qualified_name);
  }
  return extractor.extract(filePath, php, tree, context);
}

describe('eloquent relationship extractor', () => {
  it('detects hasMany', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class User extends Model {
        public function posts() { return $this->hasMany(Post::class); }
      }
    `);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].source, 'App\\Models\\User');
    assert.equal(edges[0].target, 'App\\Models\\Post');
    assert.equal(edges[0].metadata.relationship, 'hasMany');
    assert.equal(edges[0].metadata.method, 'posts');
  });

  it('detects belongsTo', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class Post extends Model {
        public function user() { return $this->belongsTo(User::class); }
      }
    `);
    assert.equal(edges[0].target, 'App\\Models\\User');
    assert.equal(edges[0].metadata.relationship, 'belongsTo');
  });

  it('detects hasOne', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class User extends Model {
        public function profile() { return $this->hasOne(Profile::class); }
      }
    `);
    assert.equal(edges[0].metadata.relationship, 'hasOne');
  });

  it('detects belongsToMany', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class User extends Model {
        public function roles() { return $this->belongsToMany(Role::class); }
      }
    `);
    assert.equal(edges[0].metadata.relationship, 'belongsToMany');
  });

  it('detects morphMany', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class Post extends Model {
        public function comments() { return $this->morphMany(Comment::class, 'commentable'); }
      }
    `);
    assert.equal(edges[0].metadata.relationship, 'morphMany');
  });

  it('detects morphTo', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class Comment extends Model {
        public function commentable() { return $this->morphTo(); }
      }
    `);
    assert.equal(edges[0].source, 'App\\Models\\Comment');
    assert.equal(edges[0].target, 'App\\Models\\Comment');
    assert.equal(edges[0].metadata.relationship, 'morphTo');
  });

  it('detects hasManyThrough', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      use App\\Models\\Post;
      class Country extends Model {
        public function posts() { return $this->hasManyThrough(Post::class, User::class); }
      }
    `);
    assert.equal(edges[0].target, 'App\\Models\\Post');
    assert.equal(edges[0].metadata.relationship, 'hasManyThrough');
  });

  it('detects multiple relationships in one model', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class User extends Model {
        public function posts() { return $this->hasMany(Post::class); }
        public function profile() { return $this->hasOne(Profile::class); }
        public function roles() { return $this->belongsToMany(Role::class); }
      }
    `);
    assert.equal(edges.length, 3);
  });

  it('resolves imported model classes', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      use App\\Domain\\Billing\\Invoice;
      class User extends Model {
        public function invoices() { return $this->hasMany(Invoice::class); }
      }
    `);
    assert.equal(edges[0].target, 'App\\Domain\\Billing\\Invoice');
  });

  it('ignores non-relationship $this calls', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class User extends Model {
        public function foo() { return $this->save(); }
      }
    `);
    assert.equal(edges.length, 0);
  });
});
