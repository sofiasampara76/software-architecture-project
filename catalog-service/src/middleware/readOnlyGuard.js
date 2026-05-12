const { getReadOnlyStatus } = require('../config/database');

/**
 * Middleware that blocks write operations when MongoDB replica set
 * has lost its primary (read-only mode).
 */
const readOnlyGuard = (req, res, next) => {
  const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

  if (writeMethods.includes(req.method) && getReadOnlyStatus()) {
    return res.status(503).json({
      error: 'Service Unavailable',
      message:
        'The catalog is currently in read-only mode due to a database outage. ' +
        'You can still browse events, but creating or modifying events is temporarily unavailable. ' +
        'Please try again later.',
      readOnly: true,
    });
  }

  next();
};

module.exports = readOnlyGuard;
