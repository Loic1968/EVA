/**
 * EVA Auth middleware — verify JWT, set req.ownerId
 */
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = (process.env.EVA_JWT_SECRET || process.env.JWT_SECRET || 'eva-dev-secret-change-in-prod').trim();
const SKIP_AUTH = process.env.EVA_SKIP_AUTH === 'true';
const DEFAULT_OWNER_EMAIL = process.env.EVA_OWNER_EMAIL || 'loic@halisoft.biz';

async function verifyAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const r = await db.query('SELECT id FROM eva.owners WHERE id = $1', [decoded.ownerId]);
      if (r.rows[0]) {
        req.ownerId = r.rows[0].id;
        req.user = { id: decoded.ownerId, email: decoded.email };
        return next();
      }
    } catch (_) {}
  }
  if (SKIP_AUTH) {
    try {
      const owner = await db.getOrCreateOwner(DEFAULT_OWNER_EMAIL, 'Loic Hennocq');
      req.ownerId = owner.id;
      req.user = { id: owner.id, email: owner.email };
      return next();
    } catch (e) {
      return res.status(503).json({ error: 'Database unavailable' });
    }
  }
  return res.status(401).json({ error: 'Authentication required' });
}

module.exports = { verifyAuth };
