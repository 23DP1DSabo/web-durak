import mariadb from 'mariadb';
import { readFileSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

// Only this randomly named scratch database is created and removed.
if (!process.env.MIGRATION_TEST_URL) throw new Error('Set MIGRATION_TEST_URL for the migration check.');
const url = new URL(process.env.MIGRATION_TEST_URL);
const name = 'durak_migration_check_' + randomBytes(6).toString('hex');
const db = await mariadb.createConnection({
  host: url.hostname, port: Number(url.port || 3306),
  user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
  multipleStatements: true, connectTimeout: 20000,
});
let created = false;
try {
  await db.query('CREATE DATABASE `' + name + '`'); created = true;
  await db.query('USE `' + name + '`');
  const target = '20261016010000_document_database_model';
  const migrations = readdirSync('prisma/migrations').filter(n => /^\d/.test(n)).sort();
  for (const migration of migrations.filter(n => n < target)) {
    await db.query(readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
  }
  await db.query("INSERT INTO User (id,email,name,passwordHash) VALUES (7,'migration@example.invalid','Legacy name','saved-hash')");
  await db.query("INSERT INTO Session (tokenHash,userId,expiresAt) VALUES ('test-session',7,'2030-01-01')");
  await db.query("INSERT INTO Post (title,authorId) VALUES ('Preserve me',7)");
  const sql = readFileSync(`prisma/migrations/${target}/migration.sql`, 'utf8');
  await assert.rejects(db.query(sql));
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM Post'))[0].n), 1);
  await db.query('DROP TEMPORARY TABLE _durak_migration_guard');
  await db.query('DELETE FROM Post');
  await db.query('UPDATE User SET name=?', ['x'.repeat(51)]);
  await assert.rejects(db.query(sql));
  await db.query('DROP TEMPORARY TABLE _durak_migration_guard');
  await db.query("UPDATE User SET name='Legacy name'");
  await db.query(sql);
  const user = (await db.query('SELECT * FROM Lietotaji'))[0];
  assert.equal(user.lietotajvards, 'legacy_7');
  assert.equal(user.paroles_jaucejvertiba, 'saved-hash');
  assert.equal(user.vards, 'Legacy name');
  assert.equal(Number((await db.query('SELECT userId FROM Session'))[0].userId), 7);
  console.log('PASS: migrations preserve accounts/sessions and reject destructive legacy data conversion.');
} finally {
  try {
    if (created && /^durak_migration_check_[a-f0-9]{12}$/.test(name)) {
      await db.query('DROP DATABASE `' + name + '`');
    }
  } finally { await db.end(); }
}
