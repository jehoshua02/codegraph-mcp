# Backlog


## Must Have

1. **Laravel extractor plugin** — routes→controllers, Eloquent relationships, events→listeners, observers, DI bindings, job dispatch, middleware, scheduled tasks
2. **Multi-repo indexing** — index multiple repos into same DB, preserve on reindex (done: Project nodes + CONTAINS_FILE, clearProject scoped)
3. **README update** — reflect current install process (MCP config in `~/.claude.json`), remove stale Docker references

## Should Have

4. **Inherited method resolution** — `$user->save()` where `save()` is on parent class creates dangling edge. Propagate parent/trait methods to child classes.
5. **PHP built-in function filtering** — `is_null`, `env`, `config` get qualified with current namespace. Should skip or recognize as built-in.
6. **Multi-language support** — TypeScript/JavaScript extractors for bank-service and other Node repos. Python for data scripts.
7. **Performance optimization** — currently 36s for 10k files. Target <10s. Parallelize parsing with worker threads.

## Nice to Have

8. **Cross-repo edge detection** — match HTTP client calls in one repo to route definitions in another
9. **Incremental indexing** — hash files, only reparse changed ones
10. **npx distribution** — publish to npm so users can `npx codegraph-mcp` without cloning
11. **Binary distribution** — Bun compile for zero-dependency install
12. **Skill/hook integration** — Claude Code skill that auto-triggers codegraph queries, hook to reindex on branch checkout
13. **Visualization** — graph visualization UI (web-based or terminal)
14. **FTS search** — full-text search across symbol bodies using SQLite FTS5

## Won't Do (for now)

- Runtime trace ingestion (Datadog APM) — parked for later discussion
- scip-laravel integration — too slow (5+ hours), OOM at scale
- codebase-memory-mcp extension — no extensibility API
