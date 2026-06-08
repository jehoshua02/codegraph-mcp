#!/usr/bin/env node

import { createServer } from 'http';
import { readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { openReadOnly, symbolSearch, symbolInbound, symbolOutbound, graphStats, graphQuery } from '../queries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(process.env.CODEGRAPH_DB || '.codegraph/graph.db');
const port = parseInt(process.env.PORT || '3333');

function withDb(fn) {
  const db = openReadOnly(dbPath);
  try { return fn(db); }
  finally { db.close(); }
}

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(readFileSync(join(__dirname, 'index.html'), 'utf-8'));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const path = url.pathname;

  if (path === '/' || path === '/index.html') return html(res);

  if (path === '/api/search') {
    const name = url.searchParams.get('name');
    const type = url.searchParams.get('type');
    const limit = parseInt(url.searchParams.get('limit') || '30');
    return json(res, withDb(db => symbolSearch(db, { name, type, limit })));
  }

  if (path === '/api/symbol') {
    const qn = url.searchParams.get('qn');
    const node = withDb(db => db.prepare('SELECT * FROM nodes WHERE qualified_name = ?').get(qn));
    if (!node) return json(res, null);
    if (node.metadata) try { node.metadata = JSON.parse(node.metadata); } catch {}
    const edges = withDb(db => db.prepare(`
      SELECT e.type, e.metadata,
        s.qualified_name as source_qn, s.name as source_name, s.type as source_type,
        t.qualified_name as target_qn, t.name as target_name, t.type as target_type
      FROM edges e
      JOIN nodes s ON s.id = e.source_id
      JOIN nodes t ON t.id = e.target_id
      WHERE s.qualified_name = ? OR t.qualified_name = ?
    `).all(qn, qn));
    return json(res, { node, edges });
  }

  if (path === '/api/inbound') {
    const qn = url.searchParams.get('qn');
    const edgeType = url.searchParams.get('edge_type');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    return json(res, withDb(db => symbolInbound(db, { qualified_name: qn, edge_type: edgeType || undefined, limit })));
  }

  if (path === '/api/outbound') {
    const qn = url.searchParams.get('qn');
    const edgeType = url.searchParams.get('edge_type');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    return json(res, withDb(db => symbolOutbound(db, { qualified_name: qn, edge_type: edgeType || undefined, limit })));
  }

  if (path === '/api/stats') {
    return json(res, withDb(db => graphStats(db)));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(port, () => {
  console.log(`codegraph-mcp UI: http://localhost:${port}`);
  console.log(`DB: ${dbPath}`);
});
