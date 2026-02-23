const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");

// Login endpoint - update user status
router.post("/login", verifyToken, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .update({
        is_online: true,
        last_online: new Date().toISOString(),
      })
      .eq("id", req.user.uid)
      .select();

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

// Logout endpoint
router.post("/logout", verifyToken, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .update({
        is_online: false,
        last_online: new Date().toISOString(),
        looking_for_roll: false,
        available_now: false,
      })
      .eq("id", req.user.uid)
      .select();

    if (error) throw error;
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
