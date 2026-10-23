require('dotenv').config();

let pool = null;
let isConnected = false;

// Parse MySQL configuration from individual env vars or DATABASE_URL
function getMysqlConfig() {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.startsWith('mysql://')) {
    try {
      const u = new URL(dbUrl);
      return {
        host: u.hostname || '127.0.0.1',
        port: parseInt(u.port, 10) || 3306,
        user: u.username || 'root',
        password: u.password || '',
        database: u.pathname.replace(/^\//, ''),
        waitForConnections: true,
        connectionLimit: 15,
        queueLimit: 0,
        charset: 'utf8mb4'
      };
    } catch (e) {
      console.error('[MySQL Config] Error parsing DATABASE_URL:', e.message);
    }
  }

  // Check individual environment variables
  const host = process.env.MYSQL_HOST;
  const database = process.env.MYSQL_DATABASE;
  if (!host && !database) {
    return null;
  }

  return {
    host: host || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: database || 'gopay_db',
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0,
    charset: 'utf8mb4'
  };
}

async function initMysql() {
  const cfg = getMysqlConfig();
  if (!cfg) {
    console.log('[MySQL] No MySQL configuration found in .env. Running in file/memory mode.');
    return false;
  }

  try {
    let mysql2;
    try {
      mysql2 = require('mysql2/promise');
    } catch (err) {
      console.warn('[MySQL] "mysql2" package is not installed yet. Run "npm install mysql2".');
      return false;
    }

    pool = mysql2.createPool(cfg);

    // Test connection
    const conn = await pool.getConnection();
    console.log(`[MySQL] Successfully connected to database "${cfg.database}" on ${cfg.host}:${cfg.port}`);
    conn.release();

    isConnected = true;
    return true;
  } catch (err) {
    console.error(`[MySQL Connection Error]:`, err.message);
    isConnected = false;
    return false;
  }
}

function isMysqlConnected() {
  return isConnected && pool !== null;
}

// Fetch all rows from a MySQL table
async function fetchAllFromMysql(table, limit = 50000) {
  if (!isMysqlConnected()) return [];
  try {
    const [rows] = await pool.query(`SELECT * FROM \`${table}\` ORDER BY id DESC LIMIT ?`, [limit]);
    return rows || [];
  } catch (err) {
    // If table doesn't exist yet, return empty
    if (err.code !== 'ER_NO_SUCH_TABLE') {
      console.error(`[MySQL Fetch Error] Table ${table}:`, err.message);
    }
    return [];
  }
}

// Persist single record to MySQL table
async function persistToMysql(table, record, operation = 'upsert', matchField = 'id') {
  if (!isMysqlConnected() || !record) return;

  try {
    const data = { ...record };

    // Format complex types (arrays / objects) to JSON strings
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key]) || (typeof data[key] === 'object' && data[key] !== null && !(data[key] instanceof Date))) {
        data[key] = JSON.stringify(data[key]);
      }
    }

    if (operation === 'insert') {
      const keys = Object.keys(data);
      if (keys.length === 0) return;
      const cols = keys.map(k => `\`${k}\``).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map(k => data[k]);
      await pool.query(`INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})`, values);
    } else if (operation === 'update') {
      const matchVal = data[matchField];
      if (matchVal === undefined || matchVal === null) return;
      delete data[matchField];
      const keys = Object.keys(data);
      if (keys.length === 0) return;
      const setClause = keys.map(k => `\`${k}\` = ?`).join(', ');
      const values = [...keys.map(k => data[k]), matchVal];
      await pool.query(`UPDATE \`${table}\` SET ${setClause} WHERE \`${matchField}\` = ?`, values);
    } else if (operation === 'upsert') {
      const keys = Object.keys(data);
      if (keys.length === 0) return;
      const cols = keys.map(k => `\`${k}\``).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const updateClause = keys.map(k => `\`${k}\` = VALUES(\`${k}\`)`).join(', ');
      const values = keys.map(k => data[k]);
      await pool.query(`INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateClause}`, values);
    } else if (operation === 'delete') {
      const matchVal = data[matchField];
      if (matchVal === undefined || matchVal === null) return;
      await pool.query(`DELETE FROM \`${table}\` WHERE \`${matchField}\` = ?`, [matchVal]);
    }
  } catch (err) {
    console.error(`[MySQL ${operation} Error] Table ${table}:`, err.message);
  }
}

// Execute arbitrary query
async function queryMysql(sql, params = []) {
  if (!isMysqlConnected()) return null;
  try {
    const [result] = await pool.query(sql, params);
    return result;
  } catch (err) {
    console.error('[MySQL Query Error]:', err.message);
    throw err;
  }
}

module.exports = {
  initMysql,
  isMysqlConnected,
  fetchAllFromMysql,
  persistToMysql,
  queryMysql,
  getPool: () => pool
};
