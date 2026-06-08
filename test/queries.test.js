import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { index } from '../src/indexer.js';
import { openReadOnly, symbolSearch, symbolInbound, symbolOutbound, symbolTrace, symbolUnreferenced, edgeSearch, graphStats, graphQuery } from '../src/queries.js';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const DB_PATH = join(__dirname, 'test-output', 'queries-test.db');

describe('queries', () => {
  let db;

  before(async () => {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
    await index(FIXTURES, DB_PATH, { project: 'test' });
    db = openReadOnly(DB_PATH);
  });

  after(() => {
    db.close();
    if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  });

  describe('symbolSearch', () => {
    it('returns total and results', () => {
      const { total, results } = symbolSearch(db, { type: 'Class' });
      assert.ok(total >= 5);
      assert.ok(results.length > 0);
    });

    it('filters by name', () => {
      const { results } = symbolSearch(db, { name: 'User' });
      assert.ok(results.some(r => r.name === 'User'));
    });

    it('filters by file_pattern', () => {
      const { results } = symbolSearch(db, { file_pattern: 'Services' });
      assert.ok(results.every(r => r.file_path.includes('Services')));
    });

    it('respects limit', () => {
      const { results } = symbolSearch(db, { limit: 2 });
      assert.ok(results.length <= 2);
    });

    it('count_only returns total with no results', () => {
      const { total, results } = symbolSearch(db, { type: 'Class', count_only: true });
      assert.ok(total >= 5);
      assert.equal(results.length, 0);
    });
  });

  describe('symbolInbound', () => {
    it('finds callers', () => {
      const results = symbolInbound(db, { qualified_name: 'App\\Repositories\\UserRepository::findById', edge_type: 'CALLS' });
      assert.ok(results.some(r => r.qualified_name === 'App\\Services\\UserService::getUser'));
    });

    it('returns empty for no matches', () => {
      const results = symbolInbound(db, { qualified_name: 'Nonexistent::method' });
      assert.equal(results.length, 0);
    });

    it('filters by array of edge types', () => {
      const results = symbolInbound(db, { qualified_name: 'App\\Models\\BaseModel', edge_type: ['EXTENDS', 'IMPLEMENTS'] });
      assert.ok(results.length > 0);
    });
  });

  describe('symbolOutbound', () => {
    it('finds callees', () => {
      const results = symbolOutbound(db, { qualified_name: 'App\\Services\\UserService::findByEmail', edge_type: 'CALLS' });
      assert.ok(results.some(r => r.qualified_name === 'App\\Models\\User::findByEmail'));
    });

    it('filters by array of edge types', () => {
      const results = symbolOutbound(db, { qualified_name: 'App\\Services\\UserService::getUser', edge_type: ['CALLS', 'DISPATCHES_JOB'] });
      assert.ok(results.length > 0);
    });
  });

  describe('symbolTrace', () => {
    it('follows multi-hop inbound', () => {
      const results = symbolTrace(db, { qualified_name: 'App\\Repositories\\UserRepository::findById', direction: 'inbound', edge_type: 'CALLS', depth: 2 });
      assert.ok(results.length > 0);
      assert.ok(results.every(r => r.hop >= 1));
    });

    it('follows outbound', () => {
      const results = symbolTrace(db, { qualified_name: 'App\\Services\\UserService::getUser', direction: 'outbound', edge_type: 'CALLS', depth: 1 });
      assert.ok(results.length > 0);
    });

    it('returns empty for isolated symbol', () => {
      const results = symbolTrace(db, { qualified_name: 'App\\Repositories\\UserRepository::findAll', direction: 'inbound', edge_type: 'CALLS', depth: 3 });
      assert.equal(results.length, 0);
    });

    it('follows multiple edge types', () => {
      const results = symbolTrace(db, { qualified_name: 'App\\Services\\UserService::getUser', direction: 'outbound', edge_type: ['CALLS', 'EXTENDS'], depth: 2 });
      assert.ok(results.length > 0);
    });
  });

  describe('symbolUnreferenced', () => {
    it('finds unreferenced methods', () => {
      const results = symbolUnreferenced(db, { node_type: 'Method' });
      assert.ok(results.some(r => r.qualified_name === 'App\\Repositories\\UserRepository::findAll'));
    });

    it('can include structural edges', () => {
      const withStructural = symbolUnreferenced(db, { node_type: 'Class', exclude_structural: false });
      const withoutStructural = symbolUnreferenced(db, { node_type: 'Class', exclude_structural: true });
      assert.ok(withoutStructural.length >= withStructural.length);
    });
  });

  describe('edgeSearch', () => {
    it('finds by type', () => {
      const results = edgeSearch(db, { type: 'EXTENDS' });
      assert.ok(results.length >= 2);
    });

    it('finds by source pattern', () => {
      const results = edgeSearch(db, { type: 'CALLS', source: 'UserService' });
      assert.ok(results.length > 0);
    });

    it('finds by target pattern', () => {
      const results = edgeSearch(db, { type: 'CALLS', target: 'UserRepository' });
      assert.ok(results.length > 0);
    });
  });

  describe('graphStats', () => {
    it('returns totals', () => {
      const stats = graphStats(db);
      assert.ok(stats.totals.nodes > 0);
      assert.ok(stats.totals.edges > 0);
    });

    it('returns node stats', () => {
      const stats = graphStats(db);
      assert.ok(stats.nodeStats.some(s => s.type === 'Class'));
    });

    it('returns type registry', () => {
      const stats = graphStats(db);
      assert.ok(stats.typeRegistry.length > 0);
      assert.ok(stats.typeRegistry.some(t => t.extractor === 'core:file'));
    });
  });

  describe('graphQuery', () => {
    it('executes SELECT queries', () => {
      const results = graphQuery(db, { sql: "SELECT COUNT(*) as c FROM nodes" });
      assert.ok(results[0].c > 0);
    });

    it('rejects non-SELECT queries', () => {
      assert.throws(() => graphQuery(db, { sql: "DELETE FROM nodes" }), /Only SELECT/);
    });

    it('applies default limit', () => {
      const results = graphQuery(db, { sql: "SELECT * FROM nodes", limit: 3 });
      assert.ok(results.length <= 3);
    });
  });
});
