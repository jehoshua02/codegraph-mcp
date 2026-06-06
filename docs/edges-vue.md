# Implicit Edges: Vue.js


| Pattern | Edge | Detectable |
|---------|------|------------|
| SFC `<template>` → `<script>` | Template refs → setup variables/methods | ✅ |
| Component registration (local) | `components: { Foo }` → imported component | ✅ |
| Component registration (global) | `app.component('Foo', Foo)` → component | ✅ |
| `<Component />` in template | Tag → component class/SFC | ✅ |
| Props declaration | Parent `:prop="val"` → child `defineProps` | ✅ |
| Emits | Child `emit('event')` → parent `@event="handler"` | ✅ |
| `provide`/`inject` | Ancestor `provide()` → descendant `inject()` by key | ⚠️ |
| `v-model` | Two-way bind → `modelValue` prop + `update:modelValue` emit | ✅ |
| Slots | Parent `<template #name>` → child `<slot name>` | ✅ |
| Pinia store usage | `useStore()` → store definition | ✅ |
| Pinia `$subscribe` | Store mutation → subscriber callback | ✅ |
| Vue Router `component` | Route config `component: Foo` → component | ✅ |
| Vue Router lazy load | `component: () => import('./Foo.vue')` → file | ✅ |
| Navigation guards | `beforeRouteEnter` / `router.beforeEach` → handler | ✅ |
| Composables | `useFoo()` → composable function | ✅ |
| `watch`/`watchEffect` | Reactive source → watcher callback | ✅ |
| `computed` | Reactive dependencies → computed getter | ⚠️ |
| Directives (custom) | `v-focus` → registered directive object | ✅ |
| Plugins | `app.use(plugin)` → plugin `install()` | ✅ |
| Teleport | `<Teleport to="#target">` → DOM target (not code edge) | ❌ |
| `defineExpose` | Exposed methods callable via template ref | ✅ |
| Transition hooks | `@enter`, `@leave` → handler methods | ✅ |
