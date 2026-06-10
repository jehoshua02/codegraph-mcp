import Database from 'better-sqlite3';

export function openReadOnly(dbPath) {
  return new Database(dbPath, { readonly: true });
}

export function symbolSearch(db, { name, type, file_pattern, count_only = false, limit = 50 }) {
  let where = ' WHERE 1=1';
  const params = [];

  if (name) {
    where += ' AND (name LIKE ? OR qualified_name LIKE ?)';
    params.push(`%${name}%`, `%${name}%`);
  }
  if (type) {
    where += ' AND type = ?';
    params.push(type);
  }
  if (file_pattern) {
    where += ' AND file_path LIKE ?';
    params.push(`%${file_pattern}%`);
  }

  const total = db.prepare('SELECT COUNT(*) as count FROM nodes' + where).get(...params).count;

  if (count_only) {
    return { total, results: [] };
  }

  const results = db.prepare('SELECT * FROM nodes' + where + ' LIMIT ?').all(...params, limit).map(parseMetadata);
  return { total, results };
}

function addEdgeTypeFilter(sql, params, edge_type) {
  if (!edge_type) return sql;
  const types = Array.isArray(edge_type) ? edge_type : [edge_type];
  sql += ` AND e.type IN (${types.map(() => '?').join(',')})`;
  params.push(...types);
  return sql;
}

export function symbolInbound(db, { qualified_name, edge_type, limit = 50 }) {
  let sql = `
    SELECT n.*, e.type as edge_type, e.metadata as edge_metadata
    FROM edges e
    JOIN nodes n ON n.id = e.source_id
    JOIN nodes target ON target.id = e.target_id
    WHERE target.qualified_name = ?
  `;
  const params = [qualified_name];
  sql = addEdgeTypeFilter(sql, params, edge_type);
  sql += ' LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params).map(row => ({
    ...parseMetadata(row),
    edge_type: row.edge_type,
    edge_metadata: row.edge_metadata ? JSON.parse(row.edge_metadata) : null,
  }));
}

export function symbolOutbound(db, { qualified_name, edge_type, limit = 50 }) {
  let sql = `
    SELECT n.*, e.type as edge_type, e.metadata as edge_metadata
    FROM edges e
    JOIN nodes n ON n.id = e.target_id
    JOIN nodes source ON source.id = e.source_id
    WHERE source.qualified_name = ?
  `;
  const params = [qualified_name];
  sql = addEdgeTypeFilter(sql, params, edge_type);
  sql += ' LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params).map(row => ({
    ...parseMetadata(row),
    edge_type: row.edge_type,
    edge_metadata: row.edge_metadata ? JSON.parse(row.edge_metadata) : null,
  }));
}

export function symbolTrace(db, { qualified_name, direction = 'inbound', edge_type, depth = 3, limit = 100 }) {
  const results = [];
  const visited = new Set();
  const queue = [{ qn: qualified_name, hop: 0 }];

  while (queue.length > 0) {
    const { qn, hop } = queue.shift();
    if (hop > depth || visited.has(qn)) continue;
    visited.add(qn);

    const neighbors = direction === 'inbound'
      ? symbolInbound(db, { qualified_name: qn, edge_type, limit: 200 })
      : symbolOutbound(db, { qualified_name: qn, edge_type, limit: 200 });

    for (const n of neighbors) {
      if (!visited.has(n.qualified_name)) {
        results.push({ ...n, hop: hop + 1 });
        queue.push({ qn: n.qualified_name, hop: hop + 1 });
      }
    }

    if (results.length >= limit) break;
  }

  return results.slice(0, limit);
}

const STRUCTURAL_EDGES = ['DEFINES', 'HAS_METHOD', 'HAS_PROPERTY', 'IMPORTS'];

export function symbolUnreferenced(db, { node_type, edge_type, exclude_structural = true, limit = 100 }) {
  const excludeTypes = exclude_structural ? STRUCTURAL_EDGES : [];
  let sql = `
    SELECT n.* FROM nodes n
    WHERE n.id NOT IN (
      SELECT DISTINCT e.target_id FROM edges e
      WHERE 1=1
  `;
  const params = [];

  if (edge_type) {
    sql += ' AND e.type = ?';
    params.push(edge_type);
  }
  if (excludeTypes.length > 0) {
    sql += ` AND e.type NOT IN (${excludeTypes.map(() => '?').join(',')})`;
    params.push(...excludeTypes);
  }
  sql += ')';

  if (node_type) {
    sql += ' AND n.type = ?';
    params.push(node_type);
  }
  sql += ' LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params).map(parseMetadata);
}

export function edgeSearch(db, { type, source, target, limit = 50 }) {
  let sql = `
    SELECT e.*, s.qualified_name as source_qn, s.name as source_name, s.type as source_type,
           t.qualified_name as target_qn, t.name as target_name, t.type as target_type
    FROM edges e
    JOIN nodes s ON s.id = e.source_id
    JOIN nodes t ON t.id = e.target_id
    WHERE 1=1
  `;
  const params = [];

  if (type) { sql += ' AND e.type = ?'; params.push(type); }
  if (source) { sql += ' AND s.qualified_name LIKE ?'; params.push(`%${source}%`); }
  if (target) { sql += ' AND t.qualified_name LIKE ?'; params.push(`%${target}%`); }
  sql += ' LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params).map(row => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }));
}

export function graphStats(db) {
  const nodeStats = db.prepare('SELECT type, COUNT(*) as count FROM nodes GROUP BY type ORDER BY count DESC').all();
  const edgeStats = db.prepare('SELECT type, COUNT(*) as count FROM edges GROUP BY type ORDER BY count DESC').all();
  const typeRegistry = db.prepare('SELECT * FROM type_registry ORDER BY extractor, kind, type').all();
  const totals = {
    nodes: db.prepare('SELECT COUNT(*) as count FROM nodes').get().count,
    edges: db.prepare('SELECT COUNT(*) as count FROM edges').get().count,
  };
  return { totals, nodeStats, edgeStats, typeRegistry };
}

export function graphQuery(db, { sql, limit = 100 }) {
  const normalized = sql.trim().toUpperCase();
  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    throw new Error('Only SELECT queries are allowed');
  }

  const hasLimit = /\bLIMIT\b/i.test(sql);
  const query = hasLimit ? sql : `${sql} LIMIT ${limit}`;
  return db.prepare(query).all();
}

function parseMetadata(row) {
  if (row.metadata && typeof row.metadata === 'string') {
    try { row.metadata = JSON.parse(row.metadata); } catch { /* keep as string */ }
  }
  return row;
}
