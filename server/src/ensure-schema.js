const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./config');

async function main() {
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
  });
  const [schemas] = await connection.query(
    'SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
    [config.db.database],
  );
  const [tables] = await connection.query(
    'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [config.db.database, 'users'],
  );
  if (!schemas.length || !tables.length) {
    const sql = fs.readFileSync(path.join(__dirname, '../../sql/schema.sql'), 'utf8');
    await connection.query(sql);
    console.log('Schema loaded');
  } else {
    console.log('Schema already present');
  }
  await connection.end();
}

main().catch((error) => {
  console.error(error.code || 'schema setup failed');
  process.exit(1);
});
