import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../src/parser.js';
import extractor from '../../src/extractors/core/symbol.js';

async function extract(php) {
  const tree = await parse(php, 'php');
  return extractor.extract('/test.php', php, tree, {});
}

describe('symbol extractor', () => {
  it('extracts a class', async () => {
    const { nodes } = await extract('<?php namespace App; class Foo {}');
    const cls = nodes.find(n => n.type === 'Class');
    assert.equal(cls.name, 'Foo');
    assert.equal(cls.qualified_name, 'App\\Foo');
  });

  it('extracts an interface', async () => {
    const { nodes } = await extract('<?php namespace App; interface Bar {}');
    const iface = nodes.find(n => n.type === 'Interface');
    assert.equal(iface.name, 'Bar');
    assert.equal(iface.qualified_name, 'App\\Bar');
  });

  it('extracts a trait', async () => {
    const { nodes } = await extract('<?php namespace App; trait Baz { public function hello() {} }');
    const trait = nodes.find(n => n.type === 'Trait');
    assert.equal(trait.name, 'Baz');
    assert.equal(trait.qualified_name, 'App\\Baz');
  });

  it('extracts an enum', async () => {
    const { nodes } = await extract('<?php namespace App; enum Color: string { case Red = "red"; }');
    const en = nodes.find(n => n.type === 'Enum');
    assert.equal(en.name, 'Color');
    assert.equal(en.qualified_name, 'App\\Color');
  });

  it('extracts methods with HAS_METHOD edges', async () => {
    const { nodes, edges } = await extract('<?php namespace App; class Foo { public function bar() {} private function baz() {} }');
    const methods = nodes.filter(n => n.type === 'Method');
    assert.equal(methods.length, 2);
    assert.equal(methods[0].qualified_name, 'App\\Foo::bar');
    assert.equal(methods[1].qualified_name, 'App\\Foo::baz');
    assert.equal(methods[1].metadata.visibility, 'private');

    const hasMethod = edges.filter(e => e.type === 'HAS_METHOD');
    assert.equal(hasMethod.length, 2);
    assert.equal(hasMethod[0].source, 'App\\Foo');
    assert.equal(hasMethod[0].target, 'App\\Foo::bar');
  });

  it('extracts properties with HAS_PROPERTY edges', async () => {
    const { nodes, edges } = await extract('<?php namespace App; class Foo { public string $name; protected int $age; }');
    const props = nodes.filter(n => n.type === 'Property');
    assert.equal(props.length, 2);
    assert.equal(props[0].name, 'name');
    assert.equal(props[0].qualified_name, 'App\\Foo::$name');

    const hasProp = edges.filter(e => e.type === 'HAS_PROPERTY');
    assert.equal(hasProp.length, 2);
  });

  it('extracts a standalone function', async () => {
    const { nodes } = await extract('<?php namespace App; function helper(string $x): bool { return true; }');
    const fn = nodes.find(n => n.type === 'Function');
    assert.equal(fn.name, 'helper');
    assert.equal(fn.qualified_name, 'App\\helper');
  });

  it('extracts static methods', async () => {
    const { nodes } = await extract('<?php namespace App; class Foo { public static function create(): self { return new self(); } }');
    const method = nodes.find(n => n.type === 'Method');
    assert.equal(method.metadata.static, true);
  });

  it('handles no namespace', async () => {
    const { nodes } = await extract('<?php class GlobalClass {}');
    const cls = nodes.find(n => n.type === 'Class');
    assert.equal(cls.qualified_name, 'GlobalClass');
  });

  it('extracts DEFINES edges from file to symbols', async () => {
    const { edges } = await extract('<?php namespace App; class Foo {} function bar() {}');
    const defines = edges.filter(e => e.type === 'DEFINES');
    assert.equal(defines.length, 2);
    assert.equal(defines[0].source, '/test.php');
    assert.equal(defines[0].target, 'App\\Foo');
  });
});
