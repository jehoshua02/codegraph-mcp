# Implicit Edges: TypeScript/JavaScript


Patterns that create non-obvious relationships between code units at the TypeScript/JavaScript level.

| Pattern | Edge | Detectable |
|---------|------|------------|
| Dynamic property access | `obj[key]` where key is variable | ❌ |
| Computed method names | `{ [methodName]() {} }` | ⚠️ |
| `call`/`apply`/`bind` | `fn.call(ctx, ...)` → function body | ⚠️ |
| Proxy handlers | `new Proxy(target, handler)` → trap methods | ⚠️ |
| Event emitter on/emit | `emitter.on('event', handler)` / `emitter.emit('event')` | ✅ |
| Decorators | `@decorator` → decorator function → decorated class/method | ✅ |
| Module re-exports | `export { foo } from './bar'` | ✅ |
| Dynamic imports | `import('./module')` → module | ✅ |
| String-based require | `require(variable)` | ❌ |
| Template literal types | Type-level string manipulation | ❌ |
| Mixin pattern | `applyMixins(Base, [MixinA, MixinB])` | ⚠️ |
| IoC/DI containers | `@injectable()` + `@inject()` → class resolution | ✅ |
| Express/NestJS routes | `@Get('/path')` or `app.get('/path', handler)` | ✅ |
| React component refs | `<Component />` JSX → component function/class | ✅ |
| Vue component registration | `components: { Foo }` → import | ✅ |
| TypeORM/Sequelize relationships | `@OneToMany(() => Post)` → model class | ✅ |
| Callback/promise chains | `.then(handler)` → function | ✅ |
| RxJS pipe operators | `pipe(map(fn), filter(fn))` → operator functions | ✅ |
