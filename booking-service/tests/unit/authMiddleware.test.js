jest.mock('axios');

const axios = require('axios');
const { authenticate } = require('../../src/middleware/authMiddleware');

function makeReqRes(headers = {}) {
  const req = { headers };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('authMiddleware', () => {
  describe('authenticate', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const { req, res, next } = makeReqRes();
      await authenticate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when Authorization header is not Bearer', async () => {
      const { req, res, next } = makeReqRes({ authorization: 'Basic abc123' });
      await authenticate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('sets req.user and calls next on valid token', async () => {
      const mockUser = { id: 'user-1', email: 'test@test.com' };
      axios.get.mockResolvedValueOnce({ data: mockUser });

      const { req, res, next } = makeReqRes({ authorization: 'Bearer valid-token' });
      await authenticate(req, res, next);

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/validate'),
        expect.objectContaining({ headers: { Authorization: 'Bearer valid-token' } })
      );
      expect(req.user).toEqual(mockUser);
      expect(req.token).toBe('valid-token');
      expect(next).toHaveBeenCalled();
    });

    it('returns 401 when auth service responds 401', async () => {
      axios.get.mockRejectedValueOnce({ response: { status: 401 } });
      const { req, res, next } = makeReqRes({ authorization: 'Bearer expired-token' });
      await authenticate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 503 when auth service is unreachable', async () => {
      axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const { req, res, next } = makeReqRes({ authorization: 'Bearer some-token' });
      await authenticate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication service unavailable' });
    });
  });
});
