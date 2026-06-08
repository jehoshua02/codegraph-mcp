import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../../src/parser.js';
import importExtractor from '../../../src/extractors/plugins/php/imports.js';
import extractor from '../../../src/extractors/plugins/laravel/event-listener.js';

async function extract(php, filePath = '/test.php') {
  const tree = await parse(php, 'php');
  const context = { importMap: new Map() };
  const ir = importExtractor.extract(filePath, php, tree, context);
  for (const imp of (ir.imports || [])) {
    context.importMap.set(`${filePath}::${imp.alias}`, imp.qualified_name);
  }
  return extractor.extract(filePath, php, tree, context);
}

describe('laravel event-listener extractor', () => {
  it('extracts $listen event→listener mappings', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Providers;
      use App\\Events\\UserRegistered;
      use App\\Listeners\\SendWelcomeEmail;
      class EventServiceProvider {
        protected $listen = [
          UserRegistered::class => [
            SendWelcomeEmail::class,
          ],
        ];
      }
    `);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].type, 'LISTENS_TO');
    assert.equal(edges[0].source, 'App\\Listeners\\SendWelcomeEmail');
    assert.equal(edges[0].target, 'App\\Events\\UserRegistered');
  });

  it('handles multiple listeners per event', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Providers;
      use App\\Events\\OrderPlaced;
      use App\\Listeners\\SendConfirmation;
      use App\\Listeners\\UpdateInventory;
      use App\\Listeners\\NotifyAdmin;
      class EventServiceProvider {
        protected $listen = [
          OrderPlaced::class => [
            SendConfirmation::class,
            UpdateInventory::class,
            NotifyAdmin::class,
          ],
        ];
      }
    `);
    assert.equal(edges.length, 3);
    assert.ok(edges.every(e => e.target === 'App\\Events\\OrderPlaced'));
    const listeners = edges.map(e => e.source);
    assert.ok(listeners.includes('App\\Listeners\\SendConfirmation'));
    assert.ok(listeners.includes('App\\Listeners\\UpdateInventory'));
    assert.ok(listeners.includes('App\\Listeners\\NotifyAdmin'));
  });

  it('handles multiple events', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Providers;
      use App\\Events\\UserRegistered;
      use App\\Events\\OrderPlaced;
      use App\\Listeners\\ListenerA;
      use App\\Listeners\\ListenerB;
      class EventServiceProvider {
        protected $listen = [
          UserRegistered::class => [
            ListenerA::class,
          ],
          OrderPlaced::class => [
            ListenerB::class,
          ],
        ];
      }
    `);
    assert.equal(edges.length, 2);
    assert.ok(edges.some(e => e.target === 'App\\Events\\UserRegistered' && e.source === 'App\\Listeners\\ListenerA'));
    assert.ok(edges.some(e => e.target === 'App\\Events\\OrderPlaced' && e.source === 'App\\Listeners\\ListenerB'));
  });

  it('ignores non-$listen properties', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Providers;
      class EventServiceProvider {
        protected $subscribe = [
          SomeSubscriber::class,
        ];
      }
    `);
    assert.equal(edges.length, 0);
  });

  it('ignores files without $listen', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class User {}
    `);
    assert.equal(edges.length, 0);
  });

  it('resolves fully qualified class names', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Providers;
      class EventServiceProvider {
        protected $listen = [
          \\App\\Events\\Foo::class => [
            \\App\\Listeners\\Bar::class,
          ],
        ];
      }
    `);
    assert.equal(edges[0].target, 'App\\Events\\Foo');
    assert.equal(edges[0].source, 'App\\Listeners\\Bar');
  });
});
