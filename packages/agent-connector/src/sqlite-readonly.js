'use strict';

const { DatabaseSync } = require('node:sqlite');

function query(file, sql) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare(sql).all(); } finally { db.close(); }
}

// OpenCode runs this query in a child so its deadline also covers native code.
if (require.main === module) {
  const sql = require('fs').readFileSync(0, 'utf8');
  process.stdout.write(JSON.stringify(query(process.argv[2], sql)));
}

module.exports = query;
