const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const router = express.Router();
const Event = require('../models/Event');
const { isReadOnlyError } = require('../db');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  next();
};

const eventBody = [
  body('title').trim().notEmpty().isLength({ min: 3, max: 200 }),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('date').isISO8601(),
  body('venue').optional().trim(),
  body('totalSeats').isInt({ min: 1 }),
  body('availableSeats').isInt({ min: 0 }),
  body('price').isFloat({ min: 0 }),
  body('category').optional().isIn(['concert','theatre','sport','conference','other']),
];

router.get('/', async (req, res, next) => {
  try {
    const { category, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (category) filter.category = category;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [events, total] = await Promise.all([
      Event.find(filter).sort({ date: 1 }).skip(skip).limit(parseInt(limit)),
      Event.countDocuments(filter),
    ]);
    res.json({ events, pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) } });
  } catch (err) { next(err); }
});

router.get('/:id', [param('id').isMongoId()], validate, async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) { next(err); }
});

router.post('/', eventBody, validate, async (req, res, next) => {
  try {
    const event = new Event(req.body);
    await event.save();
    res.status(201).json(event);
  } catch (err) {
    if (isReadOnlyError(err)) return res.status(503).json({ error: 'Service is in read-only mode', reason: 'No primary available', retryAfter: 30 });
    next(err);
  }
});

router.patch('/:id', [param('id').isMongoId()], validate, async (req, res, next) => {
  try {
    const event = await Event.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) {
    if (isReadOnlyError(err)) return res.status(503).json({ error: 'Service is in read-only mode', reason: 'No primary available', retryAfter: 30 });
    next(err);
  }
});

router.delete('/:id', [param('id').isMongoId()], validate, async (req, res, next) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.status(204).send();
  } catch (err) {
    if (isReadOnlyError(err)) return res.status(503).json({ error: 'Service is in read-only mode', reason: 'No primary available', retryAfter: 30 });
    next(err);
  }
});

module.exports = router;
