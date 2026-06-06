# codegraph-mcp

Pluggable code intelligence graph. Fast parallel indexing, extensible extractors, MCP interface.

## Setup

```bash
git clone git@github.com:jehoshua02/codegraph-mcp.git
cd codegraph-mcp
npm install
```

## Usage

### Index a codebase

```bash
node src/cli.js index /path/to/codebase .codegraph/graph.db
```

### Run as MCP server

Add to your `.mcp.json` or Claude Code MCP config:

```json
{
  "mcpServers": {
    "codegraph-mcp": {
      "command": "node",
      "args": ["/path/to/codegraph-mcp/src/index.js"],
      "env": {
        "CODEGRAPH_DB": "/path/to/codebase/.codegraph/graph.db"
      }
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `index_rebuild` | Reindex a directory (full rebuild) |
| `symbol_search` | Find symbols by name, type, file pattern |
| `symbol_inbound` | Symbols with edges pointing to a target (filterable by edge type) |
| `symbol_outbound` | Symbols a source points to (filterable by edge type) |
| `symbol_trace` | Multi-hop BFS traversal (configurable depth, direction, edge type) |
| `symbol_unreferenced` | Symbols with zero inbound edges (filterable by node/edge type) |
| `edge_search` | Find edges by type, source, or target |
| `graph_stats` | Node/edge counts by type, with extractor provenance |

## Extractors

### Built-in

| Extractor | Nodes | Edges |
|-----------|-------|-------|
| `core:file` | File | DEFINES |
| `core:symbol` | Class, Method, Function, Interface, Trait, Enum, Constant, Property | HAS_METHOD, HAS_PROPERTY |
| `core:import` | — | IMPORTS |
| `core:inheritance` | — | EXTENDS, IMPLEMENTS, USES_TRAIT |
| `core:call` | — | CALLS |

### Custom extractors

Add extractors via `.codegraph/config.json`:

```json
{
  "extractors": [
    "./my-extractors/laravel.js"
  ]
}
```

Each extractor exports:

```js
export default {
  name: 'plugin:my-extractor',
  types: [
    { type: 'MyNodeType', kind: 'node', description: '...' },
    { type: 'MY_EDGE', kind: 'edge', description: '...' },
  ],
  fileFilter: (filePath) => filePath.endsWith('.php'),
  extract(filePath, content, tree, context) {
    return { nodes: [...], edges: [...] };
  },
};
```

## Testing

```bash
npm test
```

## Query examples (sqlite3)

```sql
-- Node counts by type
SELECT type, COUNT(*) FROM nodes GROUP BY type ORDER BY COUNT(*) DESC;

-- Edge counts by type
SELECT type, COUNT(*) FROM edges GROUP BY type ORDER BY COUNT(*) DESC;

-- Find a class
SELECT * FROM nodes WHERE type = 'Class' AND name = 'Borrower';

-- Callers of a method
SELECT n.* FROM edges e
JOIN nodes n ON n.id = e.source_id
JOIN nodes t ON t.id = e.target_id
WHERE t.qualified_name = 'App\Models\Borrower::getDeal'
AND e.type = 'CALLS';

-- Unreferenced methods (excluding structural edges)
SELECT n.* FROM nodes n
WHERE n.type = 'Method'
AND n.id NOT IN (
  SELECT target_id FROM edges
  WHERE type NOT IN ('DEFINES', 'HAS_METHOD', 'HAS_PROPERTY', 'IMPORTS')
);
```
