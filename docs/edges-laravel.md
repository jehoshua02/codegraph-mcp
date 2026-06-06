# Implicit Edges: Laravel Framework


Patterns that create non-obvious relationships between code units at the Laravel framework level.

## 1 Routing

| Pattern | Edge | Detectable |
|---------|------|------------|
| Route → controller | `Route::get('/path', [Controller::class, 'method'])` | ✅ |
| Route closure | Route uses anonymous closure | ✅ |
| Route middleware string | `'auth'` string → `Authenticate::class` in Kernel | ✅ |
| Route groups with `controller()` | String method → controller at group level | ✅ |
| Middleware groups | `'web'` string → array of middleware classes | ✅ |
| Implicit route model binding | `{post}` + type-hint → `findOrFail` | ✅ |
| Single-action controller | Route with class only → `__invoke` | ✅ |
| `Route::resource` / `apiResource` | Generates multiple routes → controller methods | ✅ |

## 2 Eloquent

| Pattern | Edge | Detectable |
|---------|------|------------|
| Relationships | `$user->posts` → `posts()` → `Post::class` | ✅ |
| Polymorphic `morphTo` | Target class in DB column at runtime | ⚠️ |
| Morph map | `'post'` string → `Post::class` | ✅ |
| Accessors (legacy) | `full_name` → `getFullNameAttribute()` | ✅ |
| Accessors (modern) | `Attribute::make` return from camelCase method | ✅ |
| Scopes | `User::active()` → `scopeActive()` | ✅ |
| Global scopes | Every query → `ActiveScope::apply()` | ✅ |
| Observers | `User::save()` → `UserObserver::creating()` | ✅ |
| Model inline events | `static::creating(...)` in `booted()` | ✅ |
| `$casts` / `casts()` | Attribute → cast class `get()`/`set()` | ✅ |
| `$dispatchesEvents` | Model event → event class | ✅ |
| `$with` eager loading | Query → relationship methods | ✅ |
| `$appends` | Serialization → accessor method | ✅ |
| `$touches` | Child save → parent timestamp | ✅ |
| `SoftDeletes` | Delete → soft behavior, implicit scope | ✅ |
| `HasFactory` | `User::factory()` → `UserFactory` by convention | ✅ |
| `Prunable` | CLI command → `prunable()` method | ✅ |

## 3 Events & Queues

| Pattern | Edge | Detectable |
|---------|------|------------|
| EventServiceProvider `$listen` | Event → listener class | ✅ |
| Auto-discovered listeners | Event class → listener by type-hint on `handle()` | ✅ |
| Attribute-based listeners | `#[AsListener]` → method | ✅ |
| `Dispatchable` trait dispatch | `Event::dispatch()` via `__callStatic` | ✅ |
| Job dispatch | `dispatch()` → `Job::handle()` | ✅ |
| Job chaining | Array order → sequential dependency | ✅ |
| Job middleware | `middleware()` return → middleware classes | ✅ |
| Queue hook methods | Worker → `handle`, `failed`, `retryUntil` | ✅ |
| `ShouldQueue` on listeners | Changes execution to async | ✅ |

## 4 DI & Container

| Pattern | Edge | Detectable |
|---------|------|------------|
| Container `bind`/`singleton` | Interface type-hint → concrete class | ✅ |
| Facades | `Cache::put()` → `CacheManager::put()` via `__callStatic` | ⚠️ |
| Real-time facades | `Facades\` namespace → class | ⚠️ |
| Service provider `boot`/`register` | Framework → methods | ✅ |
| `config/app.php` providers | Array entries → provider classes | ✅ |
| Container DI in `handle()` params | Type-hints auto-resolved | ✅ |
| Deferred providers | Service resolution → provider boot | ✅ |

## 5 HTTP

| Pattern | Edge | Detectable |
|---------|------|------------|
| Form requests | Controller param → `FormRequest::rules()` | ✅ |
| API resources | `toArray()` called on serialization | ✅ |
| Policies (auto-discovery) | `{Model}Policy` naming → authorize method | ✅ |
| Gate definitions | String → closure or policy method | ✅ |
| Middleware `terminate()` | Framework → `terminate()` | ✅ |
| `Responsable` interface | Return value → `toResponse()` | ✅ |
| Pipeline `through()` | Array → pipe chain `handle()` | ✅ |

## 6 Views & Frontend

| Pattern | Edge | Detectable |
|---------|------|------------|
| Blade `@extends`/`@include` | Dot-notation → view file | ✅ |
| Blade `<x-*>` components | Tag → component class + view | ✅ |
| Custom Blade directives | `@directive` → registered closure | ✅ |
| Livewire components | Tag → class; `wire:click` → method | ✅ |
| Livewire events | String → `#[On]` handler method | ✅ |
| View composers | `View::composer` → class/closure | ✅ |
| View references | `view('users.profile')` → file | ✅ |

## 7 CLI & Scheduling

| Pattern | Edge | Detectable |
|---------|------|------------|
| Artisan commands | `$signature` → `handle()` | ✅ |
| Task scheduling | `command()`/`job()` → handler | ✅ |

## 8 Other

| Pattern | Edge | Detectable |
|---------|------|------------|
| Notification channels | `via()` string → `to*()` method | ✅ |
| Mailable | `content()` → Blade view | ✅ |
| Broadcasting | `broadcastOn()` channel → `channels.php` auth | ✅ |
| Config references | `config('db.host')` → file key | ✅ |
| Translation refs | `__('messages.welcome')` → lang file | ✅ |
| Macros / mixins | Call → macro closure | ⚠️ |
| Seeders `call()` | Seeder → child seeder `run()` | ✅ |
| Validation rule objects | Instantiation → `validate()` | ✅ |
| Exception handler | Thrown type → reportable/renderable closure | ✅ |
