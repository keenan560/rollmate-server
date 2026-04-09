const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");

// GET /notifications — Paginated notifications for current user
router.get("/notifications", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const offset = (page - 1) * limit;

    // Last 30 days for most types, friend_request persists
    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data, error, count } = await supabase
      .from("notifications")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .or(`created_at.gte.${thirtyDaysAgo},type.eq.friend_request`)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({ notifications: data || [], total: count, page, limit });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// GET /notifications/unread-count — Badge count
router.get("/notifications/unread-count", verifyToken, async (req, res) => {
  try {
    const { count, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.user.uid)
      .eq("is_read", false);

    if (error) throw error;

    res.json({ count: count || 0 });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
});

// POST /notifications/read — Mark notifications as read
router.post("/notifications/read", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { notification_ids, all } = req.body;

    if (all) {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", userId)
        .eq("is_read", false);

      if (error) throw error;
      return res.json({ success: true });
    }

    if (!notification_ids || !Array.isArray(notification_ids)) {
      return res
        .status(400)
        .json({ error: "notification_ids array or all: true required" });
    }

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .in("id", notification_ids);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("Error marking notifications as read:", error);
    res.status(500).json({ error: "Failed to mark notifications as read" });
  }
});

// DELETE /notifications/:id — Delete a single notification
router.delete("/notifications/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    const { data, error } = await supabase
      .from("notifications")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.json({ message: "Notification deleted" });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

// DELETE /notifications — Clear all notifications for current user
router.delete("/notifications", verifyToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("user_id", req.user.uid);

    if (error) throw error;

    res.json({ message: "All notifications cleared" });
  } catch (error) {
    console.error("Error clearing notifications:", error);
    res.status(500).json({ error: "Failed to clear notifications" });
  }
});

module.exports = router;
