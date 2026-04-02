const { Pool } = require('pg');

let pool;
function getPool() {
  const dbUrl = process.env.DATABASE_URL;
  if (!pool && dbUrl) {
    pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const p = getPool();
  if (!p) {
    return res.status(500).json({ error: 'DATABASE_URL is not configured' });
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
    await p.query(`
      CREATE TABLE IF NOT EXISTS rimly_auth_sessions (
        session_id VARCHAR(50) PRIMARY KEY,
        is_unlocked BOOLEAN DEFAULT false,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const body = req.body || {};

    if (body.action === 'save') {
      // historyを最新100件に制限
      const limitedHistory = Array.isArray(body.history)
        ? body.history.slice(-100)
        : body.history;

      await p.query(
        `INSERT INTO rimly_users (user_key, teams, history, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_key) DO UPDATE SET teams = EXCLUDED.teams, history = EXCLUDED.history, updated_at = NOW()`,
        [body.user_key, JSON.stringify(body.teams), JSON.stringify(limitedHistory)]
      );

      // 7日以上古いシェアを自動削除
      await p.query(`DELETE FROM rimly_shares WHERE created_at < NOW() - INTERVAL '7 days'`);

      return res.status(200).json({ success: true });
    }

    if (body.action === 'load') {
      const result = await p.query(
        `SELECT teams, history FROM rimly_users WHERE user_key = $1`,
        [body.user_key]
      );
      return res.status(200).json({ success: true, data: result.rows[0] || null });
    }

    if (body.action === 'create_share') {
      const shareId = Math.random().toString(36).substring(2, 10).toUpperCase();
      await p.query(
        `INSERT INTO rimly_shares (share_id, type, data) VALUES ($1, $2, $3)`,
        [shareId, body.type, JSON.stringify(body.data)]
      );
      return res.status(200).json({ success: true, shareId });
    }

    if (body.action === 'get_share') {
      const result = await p.query(
        `SELECT type, data FROM rimly_shares WHERE share_id = $1`,
        [body.shareId]
      );
      return res.status(200).json({ success: true, data: result.rows[0] || null });
    }

    if (body.action === 'set_auth') {
      await p.query(
        `INSERT INTO rimly_auth_sessions (session_id, is_unlocked, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (session_id) DO UPDATE SET is_unlocked = EXCLUDED.is_unlocked, updated_at = NOW()`,
        [body.session_id || 'global_admin', body.is_unlocked]
      );
      return res.status(200).json({ success: true });
    }

    if (body.action === 'get_auth') {
      const result = await p.query(
        `SELECT is_unlocked FROM rimly_auth_sessions WHERE session_id = $1`,
        [body.session_id || 'global_admin']
      );
      if (result.rows[0] && result.rows[0].is_unlocked) {
        await p.query(`UPDATE rimly_auth_sessions SET is_unlocked = false WHERE session_id = $1`, [body.session_id || 'global_admin']);
      }
      return res.status(200).json({ success: true, is_unlocked: result.rows[0]?.is_unlocked || false });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('DB Error:', e);
    return res.status(500).json({ error: e.message });
  }
};
