import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { index } from '../src/indexer.js';
import { openReadOnly, graphStats, symbolSearch, symbolInbound, symbolOutbound, symbolTrace, symbolUnreferenced, edgeSearch } from '../src/queries.js';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const DB_PATH = join(__dirname, 'test-output', 'integration.db');

describe('integration', () => {
  let result;

  before(async () => {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
    result = await index(FIXTURES, DB_PATH);
  });

  after(() => {
    if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  });

  it('indexes all fixture files', () => {
    assert.equal(result.fileCount, 9);
  });

  it('creates expected node counts', () => {
    const db = openReadOnly(DB_PATH);
    const stats = graphStats(db);
    const nodeMap = Object.fromEntries(stats.nodeStats.map(s => [s.type, s.count]));

    assert.equal(nodeMap.File, 9);
    assert.equal(nodeMap.Class, 5);
    assert.equal(nodeMap.Interface, 1);
    assert.equal(nodeMap.Trait, 1);
    assert.equal(nodeMap.Enum, 1);
    assert.equal(nodeMap.Function, 2);
    assert.ok(nodeMap.Method > 0);
    db.close();
  });

  it('creates expected edge types', () => {
    const db = openReadOnly(DB_PATH);
    const stats = graphStats(db);
    const edgeMap = Object.fromEntries(stats.edgeStats.map(s => [s.type, s.count]));

    assert.ok(edgeMap.DEFINES > 0);
    assert.ok(edgeMap.HAS_METHOD > 0);
    assert.ok(edgeMap.CALLS > 0);
    assert.ok(edgeMap.EXTENDS > 0);
    assert.ok(edgeMap.IMPLEMENTS > 0);
    assert.ok(edgeMap.USES_TRAIT > 0);
    assert.ok(edgeMap.IMPORTS > 0);
    db.close();
  });

  it('tracks type provenance', () => {
    const db = openReadOnly(DB_PATH);
    const stats = graphStats(db);
    const extractors = new Set(stats.typeRegistry.map(t => t.extractor));
    assert.ok(extractors.has('core:file'));
    assert.ok(extractors.has('plugin:php:symbol'));
    assert.ok(extractors.has('plugin:php:import'));
    assert.ok(extractors.has('plugin:php:inheritance'));
    assert.ok(extractors.has('plugin:php:call'));
    db.close();
  });

  it('finds classes by search', () => {
    const db = openReadOnly(DB_PATH);
    const { total, results } = symbolSearch(db, { name: 'User', type: 'Class' });
    assert.ok(total >= 1);
    assert.ok(results.some(r => r.qualified_name === 'App\\Models\\User'));
    db.close();
  });

  it('resolves extends edges', () => {
    const db = openReadOnly(DB_PATH);
    const results = symbolInbound(db, { qualified_name: 'App\\Models\\BaseModel', edge_type: 'EXTENDS' });
    const names = results.map(r => r.qualified_name);
    assert.ok(names.includes('App\\Models\\User'));
    assert.ok(names.includes('App\\Models\\Post'));
    db.close();
  });

  it('resolves implements edges', () => {
    const db = openReadOnly(DB_PATH);
    const results = symbolInbound(db, { qualified_name: 'App\\Contracts\\Authenticatable', edge_type: 'IMPLEMENTS' });
    assert.ok(results.some(r => r.qualified_name === 'App\\Models\\User'));
    db.close();
  });

  it('resolves trait use edges', () => {
    const db = openReadOnly(DB_PATH);
    const results = symbolInbound(db, { qualified_name: 'App\\Traits\\HasRoles', edge_type: 'USES_TRAIT' });
    assert.ok(results.some(r => r.qualified_name === 'App\\Models\\User'));
    db.close();
  });

  it('resolves static call edges', () => {
    const db = openReadOnly(DB_PATH);
    const results = symbolInbound(db, { qualified_name: 'App\\Models\\User::findByEmail', edge_type: 'CALLS' });
    assert.ok(results.some(r => r.qualified_name === 'App\\Services\\UserService::findByEmail'));
    db.close();
  });

  it('resolves $this->property->method() calls via constructor promotion', () => {
    const db = openReadOnly(DB_PATH);
    const results = symbolInbound(db, { qualified_name: 'App\\Repositories\\UserRepository::findById', edge_type: 'CALLS' });
    assert.ok(results.some(r => r.qualified_name === 'App\\Services\\UserService::getUser'));
    db.close();
  });

  it('resolves typed parameter calls to methods defined on the declared type', () => {
    const db = openReadOnly(DB_PATH);
    const results = symbolOutbound(db, { qualified_name: 'App\\Services\\UserService::findByEmail', edge_type: 'CALLS' });
    assert.ok(results.some(r => r.qualified_name === 'App\\Models\\User::findByEmail'));
    db.close();
  });

  it('resolves self:: calls', () => {
    const db = openReadOnly(DB_PATH);
    const results = symbolOutbound(db, { qualified_name: 'App\\Services\\UserService::validate', edge_type: 'CALLS' });
    assert.ok(results.some(r => r.qualified_name === 'App\\Services\\UserService::isValid'));
    db.close();
  });

  it('traces multi-hop call chains', () => {
    const db = openReadOnly(DB_PATH);
    const results = symbolTrace(db, {
      qualified_name: 'App\\Repositories\\UserRepository::findById',
      direction: 'inbound',
      edge_type: 'CALLS',
      depth: 2,
    });
    assert.ok(results.length > 0);
    assert.ok(results.some(r => r.qualified_name === 'App\\Services\\UserService::getUser'));
    db.close();
  });

  it('finds unreferenced symbols excluding structural edges', () => {
    const db = openReadOnly(DB_PATH);
    const results = symbolUnreferenced(db, { node_type: 'Method' });
    const names = results.map(r => r.qualified_name);
    assert.ok(names.includes('App\\Repositories\\UserRepository::findAll'));
    db.close();
  });

  it('finds edges by type', () => {
    const db = openReadOnly(DB_PATH);
    const results = edgeSearch(db, { type: 'EXTENDS' });
    assert.ok(results.length >= 2);
    db.close();
  });

  it('completes indexing in under 5 seconds', () => {
    assert.ok(parseFloat(result.elapsed) < 5, `Indexing took ${result.elapsed}s`);
  });
});
