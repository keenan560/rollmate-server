const { isUserSubscribed } = require("../services/subscription");

// Gate a route behind an active premium subscription. Must run after
// verifyToken (needs req.user.uid).
const requireSubscription = async (req, res, next) => {
  try {
    const subscribed = await isUserSubscribed(req.user.uid);
    if (!subscribed) {
      return res.status(403).json({
        error: "Premium subscription required",
        code: "SUBSCRIPTION_REQUIRED",
      });
    }
    next();
  } catch (error) {
    console.error("[subscription] middleware error:", error.message);
    res.status(500).json({ error: "Failed to verify subscription" });
  }
};

module.exports = { requireSubscription };
