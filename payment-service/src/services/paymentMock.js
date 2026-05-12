function chargeCard({ userId, amount }) {
  const failRate = parseFloat(process.env.PAYMENT_FAIL_RATE || '0');
  if (Math.random() < failRate) {
    return { success: false, reason: 'mock_decline' };
  }
  return {
    success: true,
    chargeId: `mock_charge_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    userId,
    amount,
  };
}

module.exports = { chargeCard };
