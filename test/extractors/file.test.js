import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import extractor from '../../src/extractors/core/file.js';

describe('file extractor', () => {
  it('creates a File node', () => {
    const { nodes } = extractor.extract('/app/Models/User.php', '<?php\nclass User {}\n', null, {});
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].type, 'File');
    assert.equal(nodes[0].name, 'User.php');
    assert.equal(nodes[0].qualified_name, '/app/Models/User.php');
    assert.equal(nodes[0].start_line, 1);
    assert.equal(nodes[0].end_line, 3);
  });

  it('creates CONTAINS_FILE edge when project is set', () => {
    const { edges } = extractor.extract('/app/Models/User.php', '<?php\n', null, { project: 'api' });
    assert.equal(edges.length, 1);
    assert.equal(edges[0].source, 'project::api');
    assert.equal(edges[0].target, '/app/Models/User.php');
    assert.equal(edges[0].type, 'CONTAINS_FILE');
  });

  it('creates no edges when project is not set', () => {
    const { edges } = extractor.extract('/app/Models/User.php', '<?php\n', null, {});
    assert.equal(edges.length, 0);
  });

  it('accepts all files', () => {
    assert.equal(extractor.fileFilter('anything.php'), true);
    assert.equal(extractor.fileFilter('something.js'), true);
    assert.equal(extractor.fileFilter('readme.md'), true);
  });
});
