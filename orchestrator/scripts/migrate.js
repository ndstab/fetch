#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);

const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  const { rows } = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
  if (rows.length > 0) {
    console.log(`✓ ${file} (already applied)`);
    continue;
  }
  const sql = readFileSync(join(migrationsDir, file), 'utf8');
  console.log(`→ applying ${file}`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log(`✓ ${file}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`✗ ${file}:`, err.message);
    process.exit(1);
  }
}

await client.end();
console.log('migrations complete');
