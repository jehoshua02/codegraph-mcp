# codegraph-mcp

Pluggable code intelligence graph. Fast parallel indexing, extensible extractors, MCP interface.

## Usage

### Index a codebase

```bash
docker build -t codegraph-mcp .
docker run --rm \
  -v /path/to/codebase:/repo:ro \
  -v $(pwd)/output:/tool/output \
  codegraph-mcp src/cli.js index /repo /tool/output/graph.db
```

### Run as MCP server

```bash
docker run --rm -i \
  -v $(pwd)/output:/tool/output \
  -e CODEGRAPH_DB=/tool/output/graph.db \
  codegraph-mcp src/index.js
```

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "codegraph-mcp": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-v", "./output:/tool/output", "-e", "CODEGRAPH_DB=/tool/output/graph.db", "codegraph-mcp", "src/index.js"]
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

### Built-in (core)

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

## Development

### Build

```bash
docker build -t codegraph-mcp .
```

### Test indexing

```bash
docker run --rm \
  -v /path/to/codebase:/repo:ro \
  -v $(pwd)/src:/tool/src \
  -v $(pwd)/output:/tool/output \
  codegraph-mcp src/cli.js index /repo /tool/output/graph.db
```

Mount `src` for live code changes without rebuilding.

### Inspect the database

```bash
docker run --rm -it \
  -v $(pwd)/output:/tool/output \
  --entrypoint sqlite3 \
  codegraph-mcp /tool/output/graph.db
```

### Query examples (sqlite3)

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
WHERE t.qualified_name = 'App\\Models\\Borrower::find'
AND e.type = 'CALLS';

-- Unreferenced methods
SELECT n.* FROM nodes n
WHERE n.type = 'Method'
AND n.id NOT IN (SELECT target_id FROM edges);
```
