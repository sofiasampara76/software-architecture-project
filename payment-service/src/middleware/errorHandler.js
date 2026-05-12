function errorHandler(err, req, res, _next) {
  console.error('[error]', err.stack || err.message);
  const status = err.status || 500;
  res.status(status).json({
    error: err.publicMessage || 'Internal server error',
    detail: process.env.NODE_ENV === 'production' ? undefined : err.message,
  });
}

module.exports = { errorHandler };
