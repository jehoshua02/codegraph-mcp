import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../../src/parser.js';
import extractor from '../../../src/extractors/plugins/laravel/model-table.js';

async function extract(php, filePath = '/test.php') {
  const tree = await parse(php, 'php');
  return extractor.extract(filePath, php, tree, {});
}

describe('laravel model-table extractor', () => {
  it('extracts $table string literal', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class User extends Model {
        protected $table = 'users';
      }
    `);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].type, 'MAPS_TO_TABLE');
    assert.equal(edges[0].source, 'App\\Models\\User');
    assert.equal(edges[0].target, 'table::users');
    assert.equal(edges[0].metadata.table, 'users');
  });

  it('extracts $table = self::TABLE with const', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class Borrower extends Model {
        public const TABLE = 'borrowers';
        protected $table = self::TABLE;
      }
    `);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].metadata.table, 'borrowers');
  });

  it('derives table name from class name when no $table', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class LoanProduct extends Model {}
    `);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].metadata.table, 'loan_products');
  });

  it('ignores non-model classes', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Services;
      class UserService {
        protected $table = 'not_a_model';
      }
    `);
    assert.equal(edges.length, 0);
  });

  it('handles Pivot base class', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class DealDocument extends Pivot {
        protected $table = 'deals_documents';
      }
    `);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].metadata.table, 'deals_documents');
  });

  it('handles Authenticatable base class', async () => {
    const { edges } = await extract(`<?php
      namespace App\\Models;
      class User extends Authenticatable {
        protected $table = 'users';
      }
    `);
    assert.equal(edges.length, 1);
  });
});
