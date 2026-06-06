# codegraph-mcp

Pluggable code intelligence graph. Fast parallel indexing, extensible extractors, MCP interface.

## 1 Install

```bash
git clone git@github.com:jehoshua02/codegraph-mcp.git
cd codegraph-mcp
npm ci
```

## 2 Configure MCP

Add to `~/.claude/.mcp.json` (user-level) or `<project>/.mcp.json` (project-level):

```json
{
  "mcpServers": {
    "codegraph-mcp": {
      "command": "node",
      "args": ["<path-to-codegraph-mcp>/src/index.js"],
      "env": {
        "CODEGRAPH_DB": "<path-to-store-graph>/graph.db"
      }
    }
  }
}
```

Restart Claude Code to activate.

## 3 Index a Codebase

Use the `index_rebuild` MCP tool from within Claude Code:

> "Index the codebase at /path/to/project"

Or via CLI:

```bash
node src/cli.js index /path/to/codebase /path/to/graph.db
```

## 4 MCP Tools

| Tool | Description |
|------|-------------|
| `index_rebuild` | Full reindex of a directory |
| `symbol_search` | Find symbols by name, type, or file pattern |
| `symbol_inbound` | Find all symbols pointing to a target (filterable by edge type) |
| `symbol_outbound` | Find all symbols a source points to (filterable by edge type) |
| `symbol_trace` | Multi-hop BFS traversal (configurable depth, direction, edge type filter) |
| `symbol_unreferenced` | Symbols with zero inbound edges (excludes structural edges by default) |
| `edge_search` | Find edges by type, source, or target |
| `graph_stats` | Node/edge counts by type with extractor provenance |

## 5 What Gets Indexed

### 5.1 Built-in Extractors

| Extractor | Nodes | Edges |
|-----------|-------|-------|
| `core:file` | File | DEFINES |
| `core:symbol` | Class, Method, Function, Interface, Trait, Enum, Constant, Property | HAS_METHOD, HAS_PROPERTY |
| `core:import` | — | IMPORTS |
| `core:inheritance` | — | EXTENDS, IMPLEMENTS, USES_TRAIT |
| `core:call` | — | CALLS |

### 5.2 Call Resolution

The call extractor resolves:
- Static calls: `Foo::bar()`
- Self/static/parent calls: `self::bar()`, `static::bar()`, `parent::bar()`
- Instance calls via `$this`: `$this->bar()`
- Typed parameter calls: `function foo(User $user) { $user->save(); }`
- Constructor-promoted property calls: `$this->repo->find()`
- Constructor calls: `new User()`
- Function calls: `helper()`

## 6 Custom Extractors

Extractors are pluggable. Add via `.codegraph/config.json` in the indexed project:

```json
{
  "extractors": [
    "./my-extractors/laravel.js"
  ]
}
```

Each extractor receives the file path, content, and tree-sitter AST:

```js
export default {
  name: 'plugin:my-extractor',
  types: [
    { type: 'MyNode', kind: 'node', description: '...' },
    { type: 'MY_EDGE', kind: 'edge', description: '...' },
  ],
  fileFilter: (filePath) => filePath.endsWith('.php'),
  extract(filePath, content, tree, context) {
    return { nodes: [...], edges: [...] };
  },
};
```

All node and edge types are traceable to the extractor that created them via `graph_stats`.

## 7 Testing

```bash
npm test
```

## 8 SQLite Schema

The graph is stored in SQLite. You can query it directly:

```sql
-- Node counts by type
SELECT type, COUNT(*) FROM nodes GROUP BY type ORDER BY COUNT(*) DESC;

-- Find a class
SELECT * FROM nodes WHERE type = 'Class' AND name = 'Borrower';

-- Callers of a method
SELECT n.qualified_name FROM edges e
JOIN nodes n ON n.id = e.source_id
JOIN nodes t ON t.id = e.target_id
WHERE t.qualified_name = 'App\Models\Borrower::getDeal'
AND e.type = 'CALLS';

-- Unreferenced methods
SELECT n.qualified_name FROM nodes n
WHERE n.type = 'Method'
AND n.id NOT IN (
  SELECT target_id FROM edges
  WHERE type NOT IN ('DEFINES', 'HAS_METHOD', 'HAS_PROPERTY', 'IMPORTS')
);
```
