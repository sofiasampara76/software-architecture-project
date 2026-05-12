const axios = require('axios');

const AUTH_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:8000';

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  try {
    const { data } = await axios.get(`${AUTH_URL}/validate`, {
      params: { token },
      timeout: 5000,
    });
    req.user = { id: data.user, email: data.user };
    next();
  } catch (err) {
    if (err.response && err.response.status === 401) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.error('[auth] validate failed:', err.message);
    return res.status(503).json({ error: 'Authentication service unavailable' });
  }
}

module.exports = { requireAuth };
