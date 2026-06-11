#!/usr/bin/env node

import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { resolve } from 'path';

const artisanPrefix = process.argv[2] || 'docker compose exec -w /app api php artisan';
const dbPath = resolve(process.argv[3] || '.codegraph/graph.db');

const db = new Database(dbPath, { readonly: true });

function artisan(cmd) {
  try {
    return JSON.parse(execSync(`${artisanPrefix} ${cmd} --json`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }));
  } catch (e) {
    console.error(`  artisan ${cmd} failed:`, e.message.slice(0, 100));
    return null;
  }
}

function pct(n, d) { return d === 0 ? '100.0' : ((n / d) * 100).toFixed(1); }

console.log('=== codegraph-mcp Validation ===\n');
console.log(`DB: ${dbPath}`);
console.log(`Artisan: ${artisanPrefix}\n`);

// --- Routes ---
console.log('--- ROUTES ---');
const artisanRoutes = artisan('route:list');
if (artisanRoutes) {
  const appRoutes = artisanRoutes.filter(r => {
    const action = r.action || '';
    return action.startsWith('App\\') || action === 'Closure';
  });

  const artisanSet = new Set();
  for (const r of appRoutes) {
    const methods = r.method.split('|');
    for (const m of methods) {
      if (m === 'HEAD') continue;
      artisanSet.add(`${m.toLowerCase()} ${r.uri.toLowerCase()}`);
    }
  }

  const graphRoutes = db.prepare("SELECT qualified_name, metadata FROM nodes WHERE type = 'Route'").all();
  const graphSet = new Set();
  for (const r of graphRoutes) {
    try {
      const meta = JSON.parse(r.metadata);
      graphSet.add(`${meta.http_method.toLowerCase()} ${meta.path.toLowerCase().replace(/^\//, '')}`);
    } catch {}
  }

  let matched = 0;
  const missingFromGraph = [];
  for (const key of artisanSet) {
    if (graphSet.has(key)) matched++;
    else missingFromGraph.push(key);
  }

  const extraInGraph = [];
  for (const key of graphSet) {
    if (!artisanSet.has(key)) extraInGraph.push(key);
  }

  console.log(`  Artisan (app routes, excl HEAD): ${artisanSet.size}`);
  console.log(`  Graph: ${graphSet.size}`);
  console.log(`  Matched: ${matched} (${pct(matched, artisanSet.size)}%)`);
  console.log(`  Missing from graph: ${missingFromGraph.length}`);
  if (missingFromGraph.length > 0 && missingFromGraph.length <= 10) {
    for (const r of missingFromGraph) console.log(`    ${r}`);
  }
  console.log(`  Extra in graph: ${extraInGraph.length}`);
}

// --- Events & Listeners ---
console.log('\n--- EVENTS & LISTENERS ---');
const artisanEvents = artisan('event:list');
if (artisanEvents) {
  const appEvents = artisanEvents.filter(e => e.event.startsWith('App\\'));

  const artisanListenMap = new Map();
  for (const e of appEvents) {
    const listeners = e.listeners
      .map(l => l.replace(/ \(ShouldQueue\)$/, ''))
      .filter(l => l.startsWith('App\\'));
    if (listeners.length > 0) artisanListenMap.set(e.event, listeners);
  }

  const graphListens = db.prepare(`
    SELECT n.qualified_name as listener, t.qualified_name as event
    FROM edges e JOIN nodes n ON n.id = e.source_id JOIN nodes t ON t.id = e.target_id
    WHERE e.type = 'LISTENS_TO'
  `).all();

  const graphListenMap = new Map();
  for (const r of graphListens) {
    if (!graphListenMap.has(r.event)) graphListenMap.set(r.event, []);
    graphListenMap.get(r.event).push(r.listener);
  }

  let eventMatched = 0;
  let eventMissing = 0;
  let listenerMatched = 0;
  let listenerMissing = 0;
  const missingEvents = [];

  for (const [event, listeners] of artisanListenMap) {
    const graphListeners = graphListenMap.get(event);
    if (graphListeners) {
      eventMatched++;
      for (const l of listeners) {
        if (graphListeners.includes(l)) listenerMatched++;
        else { listenerMissing++; }
      }
    } else {
      eventMissing++;
      missingEvents.push(event);
    }
  }

  const totalListeners = [...artisanListenMap.values()].reduce((sum, l) => sum + l.length, 0);
  console.log(`  Artisan events (App\\): ${artisanListenMap.size}`);
  console.log(`  Graph events: ${graphListenMap.size}`);
  console.log(`  Events matched: ${eventMatched} (${pct(eventMatched, artisanListenMap.size)}%)`);
  console.log(`  Events missing: ${eventMissing}`);
  if (missingEvents.length > 0 && missingEvents.length <= 10) {
    for (const e of missingEvents) console.log(`    ${e}`);
  }
  console.log(`  Artisan listeners: ${totalListeners}`);
  console.log(`  Listeners matched: ${listenerMatched} (${pct(listenerMatched, totalListeners)}%)`);
  console.log(`  Listeners missing: ${listenerMissing}`);
}

// --- Observers (via eloquent.* events in event:list) ---
console.log('\n--- OBSERVERS ---');
if (artisanEvents) {
  const eloquentEvents = artisanEvents.filter(e => e.event.startsWith('eloquent.'));

  const artisanObserverMap = new Map();
  for (const e of eloquentEvents) {
    const [, eventType, modelClass] = e.event.match(/^eloquent\.(\w+): (.+)$/) || [];
    if (!eventType || !modelClass) continue;
    for (const l of e.listeners) {
      const [observer, method] = l.split('@');
      if (observer && method) {
        const key = `${observer} -> ${modelClass}`;
        if (!artisanObserverMap.has(key)) artisanObserverMap.set(key, []);
        artisanObserverMap.get(key).push(method);
      }
    }
  }

  const graphObserves = db.prepare(`
    SELECT n.qualified_name as observer, t.qualified_name as model
    FROM edges e JOIN nodes n ON n.id = e.source_id JOIN nodes t ON t.id = e.target_id
    WHERE e.type = 'OBSERVES'
  `).all();

  const graphObserverSet = new Set(graphObserves.map(r => `${r.observer} -> ${r.model}`));

  let obsMatched = 0;
  let obsMissing = 0;
  const missingObservers = [];
  for (const key of artisanObserverMap.keys()) {
    if (graphObserverSet.has(key)) obsMatched++;
    else { obsMissing++; missingObservers.push(key); }
  }

  console.log(`  Artisan observer→model pairs: ${artisanObserverMap.size}`);
  console.log(`  Graph OBSERVES edges: ${graphObserves.length}`);
  console.log(`  Matched: ${obsMatched} (${pct(obsMatched, artisanObserverMap.size)}%)`);
  console.log(`  Missing: ${obsMissing}`);
  if (missingObservers.length > 0 && missingObservers.length <= 10) {
    for (const o of missingObservers) console.log(`    ${o}`);
  }
}

// --- Model Tables (sample check via model:show) ---
console.log('\n--- MODEL TABLES (sample) ---');
const sampleModels = ['Borrower', 'Deal', 'User', 'Document', 'Activity', 'LoanProduct', 'Offer', 'Status'];
let tableMatched = 0;
let tableMissing = 0;
for (const model of sampleModels) {
  const data = artisan(`model:show ${model}`);
  if (!data) continue;
  const artisanTable = data.table;
  const graphRow = db.prepare(`
    SELECT json_extract(e.metadata, '$.table') as tbl
    FROM edges e JOIN nodes n ON n.id = e.source_id
    WHERE n.qualified_name = ? AND e.type = 'MAPS_TO_TABLE'
  `).get(`App\\Models\\${model}`);

  const graphTable = graphRow?.tbl;
  if (artisanTable === graphTable) {
    tableMatched++;
  } else {
    tableMissing++;
    console.log(`  MISMATCH: ${model} — artisan: ${artisanTable}, graph: ${graphTable || '(missing)'}`);
  }
}
console.log(`  Sampled: ${sampleModels.length}`);
console.log(`  Matched: ${tableMatched} (${pct(tableMatched, sampleModels.length)}%)`);

// --- Summary ---
console.log('\n=== SUMMARY ===');
const nodeCount = db.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
const edgeCount = db.prepare('SELECT COUNT(*) as c FROM edges').get().c;
console.log(`  Graph: ${nodeCount} nodes, ${edgeCount} edges`);

db.close();
