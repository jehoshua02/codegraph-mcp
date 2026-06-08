#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'path';
import { index } from './indexer.js';
import { openReadOnly, symbolSearch, symbolInbound, symbolOutbound, symbolTrace, symbolUnreferenced, edgeSearch, graphStats, graphQuery } from './queries.js';

const server = new McpServer({
  name: 'codegraph-mcp',
  version: '0.1.0',
});

let dbPath = resolve(process.env.CODEGRAPH_DB || '.codegraph/graph.db');

function withDb(fn) {
  const db = openReadOnly(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const SCHEMA_DESCRIPTION = `Schema: nodes(id, type, name, qualified_name, file_path, start_line, end_line, metadata JSON), edges(id, source_id, target_id, type, metadata JSON), type_registry(type, kind, extractor, description). Node types: Project, File, Class, Method, Function, Interface, Trait, Enum, Constant, Property. Edge types: CONTAINS_FILE, DEFINES, HAS_METHOD, HAS_PROPERTY, IMPORTS, EXTENDS, IMPLEMENTS, USES_TRAIT, CALLS.`;

server.tool('index_rebuild',
  'Reindex a directory as a project. Only clears that project, preserving other indexed projects. Project name defaults to directory basename.',
  { directory: z.string(), project: z.string().optional(), db_path: z.string().optional() },
  async ({ directory, project, db_path }) => {
    if (db_path) dbPath = resolve(db_path);
    const result = await index(resolve(directory), dbPath, { project });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

server.tool('symbol_search',
  'Find symbols by name, type, or file pattern. Returns {total, results}. Use count_only:true to get just the count.',
  { name: z.string().optional(), type: z.string().optional(), file_pattern: z.string().optional(), count_only: z.boolean().optional(), limit: z.number().optional() },
  async (params) => {
    const results = withDb(db => symbolSearch(db, params));
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  }
);

const edgeTypeSchema = z.union([z.string(), z.array(z.string())]).optional();

server.tool('symbol_inbound',
  'Find all symbols with edges pointing TO this symbol. edge_type can be a string or array of strings.',
  { qualified_name: z.string(), edge_type: edgeTypeSchema, limit: z.number().optional() },
  async (params) => {
    const results = withDb(db => symbolInbound(db, params));
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  }
);

server.tool('symbol_outbound',
  'Find all symbols this symbol points TO. edge_type can be a string or array of strings.',
  { qualified_name: z.string(), edge_type: edgeTypeSchema, limit: z.number().optional() },
  async (params) => {
    const results = withDb(db => symbolOutbound(db, params));
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  }
);

server.tool('symbol_trace',
  'Multi-hop BFS traversal from a symbol. edge_type can be a string or array of strings to follow multiple edge types.',
  { qualified_name: z.string(), direction: z.enum(['inbound', 'outbound']).optional(), edge_type: edgeTypeSchema, depth: z.number().optional(), limit: z.number().optional() },
  async (params) => {
    const results = withDb(db => symbolTrace(db, params));
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  }
);

server.tool('symbol_unreferenced',
  'Find symbols with zero inbound edges. Excludes structural edges (DEFINES, HAS_METHOD, HAS_PROPERTY, IMPORTS) by default.',
  { node_type: z.string().optional(), edge_type: z.string().optional(), exclude_structural: z.boolean().optional(), limit: z.number().optional() },
  async (params) => {
    const results = withDb(db => symbolUnreferenced(db, params));
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  }
);

server.tool('edge_search',
  'Find edges by type, source, or target qualified name pattern.',
  { type: z.string().optional(), source: z.string().optional(), target: z.string().optional(), limit: z.number().optional() },
  async (params) => {
    const results = withDb(db => edgeSearch(db, params));
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  }
);

server.tool('graph_stats',
  'Node/edge counts by type with extractor provenance.',
  {},
  async () => {
    const results = withDb(db => graphStats(db));
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  }
);

server.tool('graph_query',
  `Read-only SQL query against the graph. SELECT only. ${SCHEMA_DESCRIPTION}`,
  { sql: z.string(), limit: z.number().optional() },
  async (params) => {
    const results = withDb(db => graphQuery(db, params));
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
