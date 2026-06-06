# Implicit Edges: PHP Language


Patterns that create non-obvious relationships between code units at the PHP language level.

| Pattern | Edge | Detectable |
|---------|------|------------|
| `__call` / `__callStatic` | Caller → dynamic target via magic handler | ⚠️ |
| `__get` / `__set` | Property access → magic accessor | ⚠️ |
| `__invoke` | `$obj(...)` → `__invoke` method | ⚠️ |
| `__toString` | String context → `__toString` method | ⚠️ |
| `__clone` | `clone $var` → `__clone` method | ✅ |
| Reflection | String literal → target method | ⚠️ |
| `call_user_func` | First arg → callee | ⚠️ |
| Variable functions | Variable → method/function | ⚠️ |
| String class instantiation | `new $className` → constructor | ❌ |
| Anonymous classes | Anonymous class → interface | ✅ |
| Closures as callbacks | Closure body → typed method | ✅ |
| `Closure::bind` | Closure → foreign class members | ⚠️ |
| PHP 8 Attributes | Attribute class → decorated method | ✅ |
| Trait conflict `as`/`insteadof` | Alias call → original trait method | ✅ |
| Late static binding | `new static()` → calling subclass constructor | ⚠️ |
| First-class callable `...` | `$obj->fn(...)` → method | ✅ |
