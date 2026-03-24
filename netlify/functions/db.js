const { Pool } = require('pg');

let pool;
function getPool() {
  const dbUrl = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!pool && dbUrl) {
    pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'OPTIONS, POST'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const p = getPool();
  if (!p) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'DATABASE_URL or NETLIFY_DATABASE_URL is not configured' }) };
  }

  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS rimly_users (
        user_key VARCHAR(50) PRIMARY KEY,
        teams JSONB,
        history JSONB,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await p.query(`
      CREATE TABLE IF NOT EXISTS rimly_shares (
        share_id VARCHAR(20) PRIMARY KEY,
        type VARCHAR(20),
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const req = JSON.parse(event.body || '{}');

    if (req.action === 'save') {
      await p.query(
        `INSERT INTO rimly_users (user_key, teams, history, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_key) DO UPDATE SET teams = EXCLUDED.teams, history = EXCLUDED.history, updated_at = NOW()`,
         [req.user_key, JSON.stringify(req.teams), JSON.stringify(req.history)]
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    if (req.action === 'load') {
      const res = await p.query(`SELECT teams, history FROM rimly_users WHERE user_key = $1`, [req.user_key]);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: res.rows[0] || null }) };
    }

    if (req.action === 'create_share') {
      const shareId = Math.random().toString(36).substring(2, 10).toUpperCase();
      await p.query(`INSERT INTO rimly_shares (share_id, type, data) VALUES ($1, $2, $3)`, [shareId, req.type, JSON.stringify(req.data)]);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, shareId }) };
    }

    if (req.action === 'get_share') {
      const res = await p.query(`SELECT type, data FROM rimly_shares WHERE share_id = $1`, [req.shareId]);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: res.rows[0] || null }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch(e) {
    console.error('DB Error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
