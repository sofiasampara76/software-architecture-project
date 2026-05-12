const AUTH_REQUIRED = process.env.AUTH_REQUIRED === 'true';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:8000';

async function authMiddleware(req, res, next) {
  if (!AUTH_REQUIRED) return next();

  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' });
  }

  const token = header.slice(7);
  try {
    const url = `${AUTH_SERVICE_URL}/validate?token=${encodeURIComponent(token)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (response.status === 401) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
    }
    if (!response.ok) {
      return res.status(503).json({ error: 'Service Unavailable', message: 'Authentication service unavailable' });
    }
    const data = await response.json();
    req.user = { id: data.user, email: data.user };
    next();
  } catch (err) {
    return res.status(503).json({ error: 'Service Unavailable', message: 'Authentication service unavailable' });
  }
}

module.exports = { authMiddleware };
