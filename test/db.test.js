import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, initSchema, clearGraph, clearProject, insertNodes, insertEdges, registerTypes, buildNodeIdMap } from '../src/db.js';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'test-output', 'db-test.db');

describe('db', () => {
  let db;

  before(() => {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
    db = openDb(DB_PATH);
    initSchema(db);
  });

  after(() => {
    db.close();
    if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  });

  it('creates tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
    assert.ok(tables.includes('nodes'));
    assert.ok(tables.includes('edges'));
    assert.ok(tables.includes('type_registry'));
  });

  it('inserts and retrieves nodes', () => {
    insertNodes(db, [
      { type: 'Class', name: 'Foo', qualified_name: 'App\\Foo', file_path: '/foo.php', start_line: 1, end_line: 10 },
      { type: 'Method', name: 'bar', qualified_name: 'App\\Foo::bar', file_path: '/foo.php', start_line: 2, end_line: 5, metadata: { visibility: 'public' } },
    ]);
    const nodes = db.prepare('SELECT * FROM nodes WHERE name = ?').all('Foo');
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].qualified_name, 'App\\Foo');
  });

  it('inserts edges with nodeIdMap', () => {
    const nodeIdMap = buildNodeIdMap(db);
    insertEdges(db, [
      { source: 'App\\Foo', target: 'App\\Foo::bar', type: 'HAS_METHOD' },
    ], nodeIdMap);
    const edges = db.prepare("SELECT * FROM edges WHERE type = 'HAS_METHOD'").all();
    assert.equal(edges.length, 1);
  });

  it('skips edges with missing source or target', () => {
    const nodeIdMap = buildNodeIdMap(db);
    insertEdges(db, [
      { source: 'App\\Foo', target: 'App\\Nonexistent::baz', type: 'CALLS' },
    ], nodeIdMap);
    const edges = db.prepare("SELECT * FROM edges WHERE type = 'CALLS'").all();
    assert.equal(edges.length, 0);
  });

  it('registers types', () => {
    registerTypes(db, 'test:extractor', [
      { type: 'TestNode', kind: 'node', description: 'A test node' },
      { type: 'TEST_EDGE', kind: 'edge', description: 'A test edge' },
    ]);
    const types = db.prepare('SELECT * FROM type_registry WHERE extractor = ?').all('test:extractor');
    assert.equal(types.length, 2);
  });

  it('buildNodeIdMap returns qualified_name to id map', () => {
    const map = buildNodeIdMap(db);
    assert.ok(map.has('App\\Foo'));
    assert.ok(map.has('App\\Foo::bar'));
    assert.equal(typeof map.get('App\\Foo'), 'number');
  });

  it('clearGraph removes everything', () => {
    clearGraph(db);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM nodes').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM edges').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM type_registry').get().c, 0);
  });
});

describe('clearProject', () => {
  let db;

  before(() => {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
    db = openDb(DB_PATH);
    initSchema(db);
  });

  after(() => {
    db.close();
    if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  });

  it('clears only the specified project', () => {
    insertNodes(db, [
      { type: 'Project', name: 'proj-a', qualified_name: 'project::proj-a', file_path: '/a' },
      { type: 'File', name: 'a.php', qualified_name: '/a/a.php', file_path: '/a/a.php' },
      { type: 'Class', name: 'A', qualified_name: 'A', file_path: '/a/a.php' },
      { type: 'Project', name: 'proj-b', qualified_name: 'project::proj-b', file_path: '/b' },
      { type: 'File', name: 'b.php', qualified_name: '/b/b.php', file_path: '/b/b.php' },
      { type: 'Class', name: 'B', qualified_name: 'B', file_path: '/b/b.php' },
    ]);

    const nodeIdMap = buildNodeIdMap(db);
    insertEdges(db, [
      { source: 'project::proj-a', target: '/a/a.php', type: 'CONTAINS_FILE' },
      { source: '/a/a.php', target: 'A', type: 'DEFINES' },
      { source: 'project::proj-b', target: '/b/b.php', type: 'CONTAINS_FILE' },
      { source: '/b/b.php', target: 'B', type: 'DEFINES' },
    ], nodeIdMap);

    clearProject(db, 'proj-a');

    const remaining = db.prepare('SELECT name FROM nodes ORDER BY name').all().map(r => r.name);
    assert.ok(!remaining.includes('proj-a'));
    assert.ok(!remaining.includes('a.php'));
    assert.ok(!remaining.includes('A'));
    assert.ok(remaining.includes('proj-b'));
    assert.ok(remaining.includes('b.php'));
    assert.ok(remaining.includes('B'));
  });

  it('does nothing for nonexistent project', () => {
    const before = db.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
    clearProject(db, 'nonexistent');
    const after = db.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
    assert.equal(before, after);
  });
});
