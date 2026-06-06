# Implicit Edge Catalog


Patterns that create non-obvious relationships between code units. Hitlist for extractor implementation.

- [PHP Language](edges-php.md) — 16 patterns
- [Laravel Framework](edges-laravel.md) — 60+ patterns
- [TypeScript/JavaScript](edges-typescript.md) — 18 patterns
- [Vue.js](edges-vue.md) — 22 patterns
- [NestJS](edges-nestjs.md) — 40+ patterns

## Priority for Implementation

### High — most common in Lendio codebase
1. Eloquent relationships (✅)
2. Route → controller (✅)
3. EventServiceProvider `$listen` (✅)
4. Job dispatch → `handle()` (✅)
5. Container `bind`/`singleton` (✅)
6. Observers (✅)
7. Facades (⚠️)
8. Middleware (✅)
9. Scopes (✅)
10. Accessors/mutators (✅)

### Medium
11. Blade views/components (✅)
12. Form requests (✅)
13. Policies (✅)
14. Artisan commands (✅)
15. Task scheduling (✅)
16. Notifications (✅)
17. TS/JS: imports, class hierarchy, method calls

### Low
18. Config/translation references (✅)
19. Broadcasting (✅)
20. Macros (⚠️)
21. PHP magic methods (⚠️)
22. Pipeline (✅)
