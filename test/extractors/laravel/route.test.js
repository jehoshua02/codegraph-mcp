import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../../src/parser.js';
import importExtractor from '../../../src/extractors/plugins/php/imports.js';
import extractor from '../../../src/extractors/plugins/laravel/route.js';

async function extract(php, filePath = '/routes/web.php') {
  const tree = await parse(php, 'php');
  const context = { importMap: new Map() };
  const ir = importExtractor.extract(filePath, php, tree, context);
  for (const imp of (ir.imports || [])) {
    context.importMap.set(`${filePath}::${imp.alias}`, imp.qualified_name);
  }
  return extractor.extract(filePath, php, tree, context);
}

describe('laravel route extractor', () => {
  it('detects Route::get with array handler', async () => {
    const { nodes, edges } = await extract(`<?php
      use App\\Http\\Controllers\\UserController;
      Route::get('/users', [UserController::class, 'index']);
    `);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].type, 'Route');
    assert.equal(nodes[0].metadata.http_method, 'GET');
    assert.equal(nodes[0].metadata.path, '/users');
    assert.equal(edges.length, 1);
    assert.equal(edges[0].type, 'ROUTE_HANDLES');
    assert.equal(edges[0].target, 'App\\Http\\Controllers\\UserController::index');
  });

  it('detects Route::post', async () => {
    const { nodes, edges } = await extract(`<?php
      use App\\Http\\Controllers\\UserController;
      Route::post('/users', [UserController::class, 'store']);
    `);
    assert.equal(nodes[0].metadata.http_method, 'POST');
    assert.equal(edges[0].target, 'App\\Http\\Controllers\\UserController::store');
  });

  it('detects invokable controller (class only)', async () => {
    const { edges } = await extract(`<?php
      use App\\Http\\Controllers\\HomeController;
      Route::get('/', HomeController::class);
    `);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].target, 'App\\Http\\Controllers\\HomeController::__invoke');
  });

  it('detects Route::resource', async () => {
    const { nodes, edges } = await extract(`<?php
      use App\\Http\\Controllers\\PostController;
      Route::resource('posts', PostController::class);
    `);
    assert.equal(nodes.length, 7);
    assert.equal(edges.length, 7);
    assert.ok(edges.some(e => e.target === 'App\\Http\\Controllers\\PostController::index'));
    assert.ok(edges.some(e => e.target === 'App\\Http\\Controllers\\PostController::create'));
    assert.ok(edges.some(e => e.target === 'App\\Http\\Controllers\\PostController::store'));
    assert.ok(edges.some(e => e.target === 'App\\Http\\Controllers\\PostController::show'));
    assert.ok(edges.some(e => e.target === 'App\\Http\\Controllers\\PostController::edit'));
    assert.ok(edges.some(e => e.target === 'App\\Http\\Controllers\\PostController::update'));
    assert.ok(edges.some(e => e.target === 'App\\Http\\Controllers\\PostController::destroy'));
  });

  it('detects Route::apiResource', async () => {
    const { nodes, edges } = await extract(`<?php
      use App\\Http\\Controllers\\PostController;
      Route::apiResource('posts', PostController::class);
    `);
    assert.equal(nodes.length, 5);
    assert.equal(edges.length, 5);
    assert.ok(!edges.some(e => e.target.endsWith('::create')));
    assert.ok(!edges.some(e => e.target.endsWith('::edit')));
  });

  it('handles multiple routes', async () => {
    const { nodes } = await extract(`<?php
      use App\\Http\\Controllers\\UserController;
      Route::get('/users', [UserController::class, 'index']);
      Route::post('/users', [UserController::class, 'store']);
      Route::delete('/users/{id}', [UserController::class, 'destroy']);
    `);
    assert.equal(nodes.length, 3);
  });

  it('detects Route::controller()->group() with string method names', async () => {
    const { nodes, edges } = await extract(`<?php
      use App\\Http\\Controllers\\UserController;
      Route::controller(UserController::class)->group(function () {
        Route::get('/users', 'index');
        Route::post('/users', 'store');
      });
    `);
    assert.equal(nodes.length, 2);
    assert.ok(edges.some(e => e.target === 'App\\Http\\Controllers\\UserController::index'));
    assert.ok(edges.some(e => e.target === 'App\\Http\\Controllers\\UserController::store'));
  });

  it('resolves Route::group prefix', async () => {
    const { nodes } = await extract(`<?php
      use App\\Http\\Controllers\\UserController;
      Route::group(['prefix' => 'api/v1'], function () {
        Route::get('/users', [UserController::class, 'index']);
      });
    `);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].metadata.path, 'api/v1/users');
  });

  it('resolves Route::prefix()->group()', async () => {
    const { nodes } = await extract(`<?php
      use App\\Http\\Controllers\\UserController;
      Route::prefix('admin')->group(function () {
        Route::get('/dashboard', [UserController::class, 'index']);
      });
    `);
    assert.equal(nodes[0].metadata.path, 'admin/dashboard');
  });

  it('resolves nested group prefixes', async () => {
    const { nodes } = await extract(`<?php
      use App\\Http\\Controllers\\UserController;
      Route::group(['prefix' => 'api'], function () {
        Route::group(['prefix' => 'v1'], function () {
          Route::get('/users', [UserController::class, 'index']);
        });
      });
    `);
    assert.equal(nodes[0].metadata.path, 'api/v1/users');
  });

  it('detects closure routes', async () => {
    const { nodes, edges } = await extract(`<?php
      Route::get('/health', function () { return 'ok'; });
    `);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].type, 'Route');
    assert.equal(nodes[0].metadata.handler, 'Closure');
    assert.equal(edges.length, 0);
  });

  it('resolves prefix + controller group combined', async () => {
    const { nodes, edges } = await extract(`<?php
      use App\\Http\\Controllers\\UserController;
      Route::prefix('api')->controller(UserController::class)->group(function () {
        Route::get('/users', 'index');
        Route::post('/users', 'store');
      });
    `);
    assert.equal(nodes.length, 2);
    assert.equal(nodes[0].metadata.path, 'api/users');
    assert.ok(edges.some(e => e.target === 'App\\Http\\Controllers\\UserController::index'));
  });

  it('detects string Controller@method syntax', async () => {
    const { edges } = await extract(`<?php
      Route::get('/users', 'UserController@index');
    `);
    assert.equal(edges.length, 1);
    assert.ok(edges[0].target.includes('UserController::index'));
  });

  it('ignores non-Route static calls', async () => {
    const { nodes } = await extract(`<?php
      Cache::get('key');
      DB::table('users');
    `);
    assert.equal(nodes.length, 0);
  });

  it('ignores Route methods that are not HTTP verbs', async () => {
    const { nodes } = await extract(`<?php
      Route::prefix('/admin');
      Route::middleware('auth');
    `);
    assert.equal(nodes.length, 0);
  });
});
