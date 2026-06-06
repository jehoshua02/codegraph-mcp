import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discoverFiles, readFiles } from '../src/reader.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

describe('discoverFiles', () => {
  it('finds all PHP files in fixtures', async () => {
    const files = await discoverFiles(FIXTURES);
    assert.equal(files.length, 9);
    assert.ok(files.some(f => f.endsWith('User.php')));
    assert.ok(files.some(f => f.endsWith('helpers.php')));
  });

  it('skips node_modules and vendor', async () => {
    const files = await discoverFiles(FIXTURES);
    assert.ok(!files.some(f => f.includes('node_modules')));
    assert.ok(!files.some(f => f.includes('vendor')));
  });
});

describe('readFiles', () => {
  it('reads file contents', async () => {
    const files = await discoverFiles(FIXTURES);
    const results = await readFiles(files.slice(0, 2));
    assert.equal(results.length, 2);
    assert.ok(results[0].content.includes('<?php'));
    assert.ok(results[0].filePath.endsWith('.php'));
  });

  it('handles empty file list', async () => {
    const results = await readFiles([]);
    assert.equal(results.length, 0);
  });
});
