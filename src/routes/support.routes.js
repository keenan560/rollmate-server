const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");

// POST /support/contact - Submit a support request
router.post("/support/contact", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { subject, message } = req.body;

    // Validation
    if (!subject || !message) {
      return res.status(400).json({
        error: "Subject and message are required",
      });
    }

    if (subject.trim().length === 0 || message.trim().length === 0) {
      return res.status(400).json({
        error: "Subject and message cannot be empty",
      });
    }

    console.log(`Support ticket from user ${userId}: ${subject}`);

    // Insert support ticket
    const { data, error } = await supabase
      .from("support_tickets")
      .insert({
        user_id: userId,
        subject: subject.trim(),
        message: message.trim(),
        status: "open",
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating support ticket:", error);
      throw error;
    }

    console.log(`Support ticket created: ${data.id}`);

    // TODO: Send email notification to support team
    // You can integrate SendGrid, AWS SES, or other email service here

    res.json({
      success: true,
      message: "Your support request has been submitted successfully",
      ticket_id: data.id,
    });
  } catch (error) {
    console.error("Error submitting support request:", error);
    res.status(500).json({
      error: "Failed to submit support request",
      message: error.message,
    });
  }
});

// GET /support/tickets - Get user's support tickets
router.get("/support/tickets", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    const { data, error } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error("Error fetching support tickets:", error);
    res.status(500).json({
      error: "Failed to fetch support tickets",
      message: error.message,
    });
  }
});

// GET /support/tickets/:ticketId - Get single ticket details
router.get("/support/tickets/:ticketId", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { ticketId } = req.params;

    const { data, error } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("id", ticketId)
      .eq("user_id", userId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ error: "Ticket not found" });
      }
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error("Error fetching support ticket:", error);
    res.status(500).json({
      error: "Failed to fetch support ticket",
      message: error.message,
    });
  }
});

module.exports = router;
