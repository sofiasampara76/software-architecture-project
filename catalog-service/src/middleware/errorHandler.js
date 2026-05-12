function errorHandler(err, req, res, next) {
  console.error('[error]', err.message);
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: 'Validation error', details: Object.values(err.errors).map(e => e.message) });
  }
  if (err.code === 11000) return res.status(409).json({ error: 'Duplicate key' });
  if (err.name === 'CastError') return res.status(400).json({ error: 'Invalid ID format' });
  res.status(500).json({ error: 'Internal server error', message: err.message });
}
module.exports = { errorHandler };
