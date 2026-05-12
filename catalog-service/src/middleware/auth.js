// Stub auth middleware — replace with real JWT validation once Auth Service is ready
// For now: if AUTH_REQUIRED=false (default), all requests pass through

const AUTH_REQUIRED = process.env.AUTH_REQUIRED === 'true';

function authMiddleware(req, res, next) {
  if (!AUTH_REQUIRED) return next();

  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' });
  }
  // TODO: validate JWT against Auth Service /validate endpoint
  next();
}

module.exports = { authMiddleware };
