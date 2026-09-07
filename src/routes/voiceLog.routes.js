const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { requireSubscription } = require("../middleware/subscription");
const { extractStructuredLog } = require("../services/voiceLog");

// POST /voice-log/extract — Premium. Takes a dictated transcript, returns a
// structured draft (training log or sparring session shape) for the client
// to show as an editable preview. Doesn't save anything — the client saves
// via the existing /training-logs or /sparring-sessions POST routes once
// the user confirms, so the actual persistence path is unchanged.
router.post(
  "/voice-log/extract",
  verifyToken,
  requireSubscription,
  async (req, res) => {
    try {
      const { transcript } = req.body;
      if (!transcript || !transcript.trim()) {
        return res.status(400).json({ error: "transcript is required" });
      }
      if (transcript.length > 4000) {
        return res.status(400).json({ error: "transcript is too long" });
      }

      const draft = await extractStructuredLog(transcript.trim());
      res.json(draft);
    } catch (error) {
      console.error("[voice-log] extract error:", error.message);
      res.status(500).json({ error: "Failed to process voice log" });
    }
  },
);

module.exports = router;
