import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export function openDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      qualified_name TEXT,
      file_path TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES nodes(id),
      target_id INTEGER NOT NULL REFERENCES nodes(id),
      type TEXT NOT NULL,
      metadata TEXT,
      UNIQUE(source_id, target_id, type)
    );

    CREATE TABLE IF NOT EXISTS type_registry (
      type TEXT NOT NULL,
      kind TEXT NOT NULL,
      extractor TEXT NOT NULL,
      description TEXT,
      PRIMARY KEY (type, kind)
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
    CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
    CREATE INDEX IF NOT EXISTS idx_nodes_qualified_name ON nodes(qualified_name);
    CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path);
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
  `);
}

export function clearProject(db, project) {
  const nodeIds = db.prepare("SELECT id FROM nodes WHERE type = 'Project' AND name = ?").all(project).map(r => r.id);
  if (nodeIds.length === 0) return;

  for (const pid of nodeIds) {
    const fileIds = db.prepare("SELECT target_id as id FROM edges WHERE source_id = ? AND type = 'CONTAINS_FILE'").all(pid).map(r => r.id);
    const allIds = [pid, ...fileIds];

    // Find all nodes defined in these files
    const definedIds = db.prepare(
      `SELECT target_id as id FROM edges WHERE source_id IN (${fileIds.map(() => '?').join(',')}) AND type = 'DEFINES'`
    ).all(...fileIds).map(r => r.id);

    // Find all nodes that are children of defined nodes (methods, properties)
    const childIds = db.prepare(
      `SELECT target_id as id FROM edges WHERE source_id IN (${definedIds.map(() => '?').join(',')}) AND type IN ('HAS_METHOD', 'HAS_PROPERTY')`
    ).all(...definedIds).map(r => r.id);

    const removeIds = [...allIds, ...definedIds, ...childIds];
    if (removeIds.length === 0) return;

    const placeholders = removeIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM edges WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`).run(...removeIds, ...removeIds);
    db.prepare(`DELETE FROM nodes WHERE id IN (${placeholders})`).run(...removeIds);
  }
}

export function clearGraph(db) {
  db.exec('DELETE FROM edges; DELETE FROM nodes; DELETE FROM type_registry;');
}

export function insertNodes(db, nodes) {
  const stmt = db.prepare(
    'INSERT INTO nodes (type, name, qualified_name, file_path, start_line, end_line, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const n of nodes) {
    stmt.run(n.type, n.name, n.qualified_name ?? null, n.file_path, n.start_line ?? null, n.end_line ?? null, n.metadata ? JSON.stringify(n.metadata) : null);
  }
}

export function insertEdges(db, edges, nodeIdMap) {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO edges (source_id, target_id, type, metadata) VALUES (?, ?, ?, ?)'
  );
  for (const e of edges) {
    const sourceId = nodeIdMap.get(e.source);
    const targetId = nodeIdMap.get(e.target);
    if (sourceId && targetId) {
      stmt.run(sourceId, targetId, e.type, e.metadata ? JSON.stringify(e.metadata) : null);
    }
  }
}

export function registerTypes(db, extractor, types) {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO type_registry (type, kind, extractor, description) VALUES (?, ?, ?, ?)'
  );
  for (const t of types) {
    stmt.run(t.type, t.kind, extractor, t.description ?? null);
  }
}

export function buildNodeIdMap(db) {
  const map = new Map();
  for (const row of db.prepare('SELECT id, qualified_name FROM nodes WHERE qualified_name IS NOT NULL').iterate()) {
    map.set(row.qualified_name, row.id);
  }
  return map;
}
