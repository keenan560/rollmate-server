const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { optimizeUserImages } = require("../utils/imageOptimization");

// POST /roll-requests - Send a roll request
router.post("/roll-requests", verifyToken, async (req, res) => {
  try {
    const senderId = req.user.uid;
    const { recipientId, message, proposedDate, proposedTime } = req.body;

    if (!recipientId) {
      return res.status(400).json({ error: "Recipient ID is required" });
    }

    // Create roll request (using receiver_id to match existing schema)
    const { data: rollRequest, error: requestError } = await supabase
      .from("roll_requests")
      .insert({
        sender_id: senderId,
        receiver_id: recipientId, // Note: using receiver_id to match existing schema
        message: message || null,
        proposed_date: proposedDate || null,
        proposed_time: proposedTime || null,
        status: "pending",
      })
      .select()
      .single();

    if (requestError) {
      console.error("Error creating roll request:", requestError);
      return res.status(500).json({ error: "Failed to create roll request" });
    }

    // TODO: Send push notification to recipient
    // This would integrate with Firebase Cloud Messaging

    res.json({
      success: true,
      request: rollRequest,
    });
  } catch (error) {
    console.error("Error sending roll request:", error);
    res.status(500).json({ error: "Failed to send roll request" });
  }
});

// NOTE: GET /roll-requests is handled in roll.routes.js (returns both received + sent with user joins)

// PUT /roll-requests/:id/accept - Accept a roll request
router.put("/roll-requests/:id/accept", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const requestId = req.params.id;

    // Verify the request belongs to this user
    const { data: request, error: fetchError } = await supabase
      .from("roll_requests")
      .select("*")
      .eq("id", requestId)
      .eq("receiver_id", userId) // Note: using receiver_id to match existing schema
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ error: "Roll request not found" });
    }

    // Update status to accepted
    const { error: updateError } = await supabase
      .from("roll_requests")
      .update({ status: "accepted", updated_at: new Date().toISOString() })
      .eq("id", requestId);

    if (updateError) {
      console.error("Error accepting roll request:", updateError);
      return res.status(500).json({ error: "Failed to accept request" });
    }

    // TODO: Send notification to sender that request was accepted

    res.json({ success: true });
  } catch (error) {
    console.error("Error accepting roll request:", error);
    res.status(500).json({ error: "Failed to accept roll request" });
  }
});

// PUT /roll-requests/:id/decline - Decline a roll request
router.put("/roll-requests/:id/decline", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const requestId = req.params.id;

    // Verify the request belongs to this user
    const { data: request, error: fetchError } = await supabase
      .from("roll_requests")
      .select("*")
      .eq("id", requestId)
      .eq("receiver_id", userId) // Note: using receiver_id to match existing schema
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ error: "Roll request not found" });
    }

    // Update status to declined
    const { error: updateError } = await supabase
      .from("roll_requests")
      .update({ status: "declined", updated_at: new Date().toISOString() })
      .eq("id", requestId);

    if (updateError) {
      console.error("Error declining roll request:", updateError);
      return res.status(500).json({ error: "Failed to decline request" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error declining roll request:", error);
    res.status(500).json({ error: "Failed to decline roll request" });
  }
});

module.exports = router;
