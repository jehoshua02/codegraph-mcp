#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ARTISAN_FILE = '/Users/joshuastoutenburg/.claude/projects/-Users-joshuastoutenburg-dev-lendio-infra/8b56081a-07ba-4544-9821-171a2393c718/tool-results/bhv3xieh0.txt';
const DB_PATH = '/Users/joshuastoutenburg/dojo/jehoshua02/codegraph-mcp/.codegraph/graph.db';

// 1. Read artisan route:list JSON
const raw = fs.readFileSync(ARTISAN_FILE, 'utf8');
const artisanRoutes = JSON.parse(raw);

// Build a normalized key: METHOD /path (uppercase method, lowercase path)
function artisanKey(r) {
  return `${r.method.toUpperCase()} ${r.uri.toLowerCase()}`;
}

// Normalize a path: ensure leading slash, lowercase everything including params
function normalizePath(p) {
  const withSlash = p.startsWith('/') ? p : '/' + p;
  return withSlash.toLowerCase();
}

const artisanMap = new Map();
for (const r of artisanRoutes) {
  // method can be "GET|HEAD" etc — split and add each
  const methods = r.method.split('|');
  for (const m of methods) {
    const key = `${m.toUpperCase()} ${normalizePath(r.uri)}`;
    artisanMap.set(key, r);
  }
}

// 2. Query SQLite for Route nodes and ROUTE_HANDLES edges
const db = new Database(DB_PATH, { readonly: true });

const routeNodes = db.prepare(`
  SELECT id, qualified_name, name, file_path, start_line
  FROM nodes
  WHERE type = 'Route'
`).all();

const routeEdges = db.prepare(`
  SELECT e.source_id, e.target_id, n.qualified_name as target_qn
  FROM edges e
  JOIN nodes n ON n.id = e.target_id
  WHERE e.type = 'ROUTE_HANDLES'
`).all();

// Build edge map: source_id -> target qualified_name
const edgeMap = new Map();
for (const e of routeEdges) {
  edgeMap.set(e.source_id, e.target_qn);
}

// Parse codegraph route qualified_name: "route::METHOD::/path"
function parseCodegraphKey(qn) {
  // format: route::get::/path or route::post::/path etc
  const match = qn.match(/^route::([^:]+)::(.+)$/i);
  if (!match) return null;
  return `${match[1].toUpperCase()} ${normalizePath(match[2])}`;
}

const codegraphMap = new Map();
for (const node of routeNodes) {
  const key = parseCodegraphKey(node.qualified_name);
  if (key) {
    codegraphMap.set(key, { ...node, handler: edgeMap.get(node.id) || null });
  }
}

db.close();

// 3. Compare
const artisanKeys = new Set(artisanMap.keys());
const codegraphKeys = new Set(codegraphMap.keys());

const inArtisanOnly = [...artisanKeys].filter(k => !codegraphKeys.has(k));
const inCodegraphOnly = [...codegraphKeys].filter(k => !artisanKeys.has(k));
const inBoth = [...artisanKeys].filter(k => codegraphKeys.has(k));

// Detect "suffix match" — codegraph route is a suffix of an artisan route (prefix stripping)
// e.g. codegraph "POST /borrower" matches artisan "POST /borrower-portal/borrower"
let suffixMatchCount = 0;
const suffixMatchExamples = [];
for (const cgKey of inCodegraphOnly) {
  const [cgMethod, cgPath] = cgKey.split(' ');
  // Find artisan routes where path ends with cgPath
  const matches = [...artisanKeys].filter(ak => {
    const [am, ap] = ak.split(' ');
    return am === cgMethod && (ap.endsWith(cgPath) || ap.endsWith(cgPath.replace(/^\//, '')));
  });
  if (matches.length > 0) {
    suffixMatchCount++;
    if (suffixMatchExamples.length < 5) {
      suffixMatchExamples.push({ cgKey, artisanMatches: matches.slice(0,2) });
    }
  }
}

// 4. Categorize missing artisan routes
function categorize(route) {
  const action = route.action || '';
  if (action === 'Closure') return 'Closure';
  if (route.uri && route.uri.startsWith('nova-api/')) return 'Nova API';
  if (route.uri && route.uri.startsWith('nova/')) return 'Nova';
  if (action.includes('Inertia')) return 'Inertia';
  if (action.includes('Livewire')) return 'Livewire';
  if (action.includes('\\Nova\\')) return 'Nova Controller';
  if (action.includes('Laravel\\')) return 'Laravel Package';
  if (action.includes('Horizon\\')) return 'Horizon';
  if (action.includes('Telescope\\')) return 'Telescope';
  if (action.includes('Fortify\\')) return 'Fortify';
  if (action.includes('Sanctum\\')) return 'Sanctum';
  if (!action) return 'No Action';
  return 'App Controller';
}

const categories = {};
for (const key of inArtisanOnly) {
  const r = artisanMap.get(key);
  const cat = categorize(r);
  categories[cat] = (categories[cat] || 0) + 1;
}

// Top 10 missing from codegraph (in artisan only)
const top10missing = inArtisanOnly.slice(0, 10).map(key => {
  const r = artisanMap.get(key);
  return { key, action: r.action, middleware: Array.isArray(r.middleware) ? r.middleware.join(',') : r.middleware };
});

// Top 10 extra in codegraph (not in artisan)
const top10extra = inCodegraphOnly.slice(0, 10).map(key => {
  const n = codegraphMap.get(key);
  return { key, handler: n.handler, file: n.file_path };
});

// Output summary
console.log('=== ROUTE COMPARISON SUMMARY ===\n');
console.log(`Artisan route:list total keys (method+path combos): ${artisanMap.size}`);
console.log(`  (unique route entries from JSON: ${artisanRoutes.length})`);
console.log(`Codegraph Route nodes: ${codegraphMap.size}`);
console.log(`  (total Route nodes in DB: ${routeNodes.length})`);
console.log(`  (ROUTE_HANDLES edges: ${routeEdges.length})\n`);

console.log(`Matched (in both):             ${inBoth.length}`);
console.log(`In artisan only (missing from codegraph): ${inArtisanOnly.length}`);
console.log(`In codegraph only (extra/stale):          ${inCodegraphOnly.length}`);
console.log(`  Of codegraph-only, suffix-match artisan:  ${suffixMatchCount} (codegraph missing route group prefix)\n`);

console.log('--- Categories of routes missing from codegraph ---');
const sortedCats = Object.entries(categories).sort((a,b) => b[1]-a[1]);
for (const [cat, count] of sortedCats) {
  console.log(`  ${cat.padEnd(25)} ${count}`);
}

console.log('\n--- Top 10 artisan routes NOT in codegraph ---');
for (const r of top10missing) {
  console.log(`  ${r.key}`);
  console.log(`    action: ${r.action}`);
}

if (top10extra.length > 0) {
  console.log('\n--- Top 10 codegraph routes NOT in artisan ---');
  for (const r of top10extra) {
    console.log(`  ${r.key}`);
    console.log(`    handler: ${r.handler || '(none)'}`);
  }
}

if (suffixMatchExamples.length > 0) {
  console.log('\n--- Examples: codegraph routes that are suffix of artisan routes (missing prefix) ---');
  for (const ex of suffixMatchExamples) {
    console.log(`  codegraph: ${ex.cgKey}`);
    for (const am of ex.artisanMatches) {
      console.log(`    artisan:  ${am}`);
    }
  }
}

console.log('\n--- Root cause summary ---');
console.log('  Codegraph indexes routes from route definition files without applying route group');
console.log('  prefixes. So "POST /borrower" in a file loaded under "borrower-portal/" prefix');
console.log('  becomes "borrower-portal/borrower" in artisan but stays "/borrower" in codegraph.');
console.log(`  This accounts for ~${suffixMatchCount} of the ${inCodegraphOnly.length} codegraph-only routes.`);
console.log(`  The ${inArtisanOnly.length} artisan-only routes include:`)
console.log('    - Routes from route groups whose prefixes codegraph cannot resolve statically');
console.log('    - Nova framework routes (auto-registered, not in route files)');
console.log('    - Laravel package routes (Ignition, Horizon, Telescope, Sanctum)');
console.log('    - Closure routes');

