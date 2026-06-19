const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");

// GET /training-reminders — Get current user's reminder config
router.get("/training-reminders", verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("training_reminders")
      .select("enabled, days, reminder_time, timezone")
      .eq("user_id", req.user.uid)
      .single();

    if (error && error.code === "PGRST116") {
      // No row found — return defaults
      return res.json({
        enabled: false,
        days: [],
        reminder_time: "20:00",
        timezone: "America/New_York",
      });
    }

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error("Error fetching training reminder:", error);
    res.status(500).json({ error: "Failed to fetch training reminder" });
  }
});

// PUT /training-reminders — Upsert reminder config
router.put("/training-reminders", verifyToken, async (req, res) => {
  try {
    const { enabled, days, reminder_time, timezone } = req.body;

    // Validate days
    const validDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    if (days !== undefined) {
      if (!Array.isArray(days) || !days.every((d) => validDays.includes(d))) {
        return res.status(400).json({
          error: `days must be an array of: ${validDays.join(", ")}`,
        });
      }
    }

    // Validate reminder_time format (HH:MM)
    if (reminder_time !== undefined) {
      if (!/^\d{2}:\d{2}$/.test(reminder_time)) {
        return res
          .status(400)
          .json({ error: "reminder_time must be in HH:MM format" });
      }
    }

    const { error } = await supabase.from("training_reminders").upsert(
      {
        user_id: req.user.uid,
        enabled: enabled ?? false,
        days: days ?? [],
        reminder_time: reminder_time ?? "20:00",
        timezone: timezone ?? "America/New_York",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("Error updating training reminder:", error);
    res.status(500).json({ error: "Failed to update training reminder" });
  }
});

// POST /training-reminders/test — Send a test reminder push (dev/debug only)
router.post("/training-reminders/test", verifyToken, async (req, res) => {
  try {
    const { sendNotification } = require("../services/notification");

    const result = await sendNotification(
      req.user.uid,
      "Don't forget to log your training session today.",
      {
        title: "Time to train! 🥋",
        data: { type: "session" },
      },
    );

    res.json({ success: true, result });
  } catch (error) {
    console.error("Error sending test reminder:", error);
    res.status(500).json({ error: "Failed to send test reminder" });
  }
});

module.exports = router;
