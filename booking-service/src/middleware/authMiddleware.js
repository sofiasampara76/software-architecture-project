const axios = require('axios');

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.substring(7);

  try {
    const response = await axios.get(`${AUTH_SERVICE_URL}/validate`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });
    req.user = response.data;
    req.token = token;
    next();
  } catch (err) {
    if (err.response && err.response.status === 401) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.error('Auth service error:', err.message);
    return res.status(503).json({ error: 'Authentication service unavailable' });
  }
}

module.exports = { authenticate };
