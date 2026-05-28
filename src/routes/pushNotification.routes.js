const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const admin = require("../services/firebase");

// POST /users/fcm-token — Register or update FCM device token
router.post("/users/fcm-token", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { token, platform } = req.body;

    if (!token) {
      return res.status(400).json({ error: "token is required" });
    }

    if (platform && !["ios", "android"].includes(platform)) {
      return res.status(400).json({ error: "platform must be ios or android" });
    }

    // Upsert into device_tokens table (supports multiple devices per user)
    const { error: deviceError } = await supabase.from("device_tokens").upsert(
      {
        user_id: userId,
        token,
        platform: platform || "ios",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );

    if (deviceError) {
      console.error("Error saving device token:", deviceError);
      // Fallback: update the fcm_token column on users table directly
      const { error: userError } = await supabase
        .from("users")
        .update({ fcm_token: token })
        .eq("id", userId);

      if (userError) throw userError;

      return res.json({ success: true, fallback: true });
    }

    // Also keep the users.fcm_token column in sync (for backward compat)
    await supabase.from("users").update({ fcm_token: token }).eq("id", userId);

    res.json({ success: true });
  } catch (error) {
    console.error("Error registering FCM token:", error);
    res.status(500).json({ error: "Failed to register device token" });
  }
});

// DELETE /users/fcm-token — Remove FCM token on logout
router.delete("/users/fcm-token", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: "token is required" });
    }

    // Remove from device_tokens table
    await supabase
      .from("device_tokens")
      .delete()
      .eq("user_id", userId)
      .eq("token", token);

    // Clear from users table if it matches
    const { data: user } = await supabase
      .from("users")
      .select("fcm_token")
      .eq("id", userId)
      .single();

    if (user?.fcm_token === token) {
      await supabase.from("users").update({ fcm_token: null }).eq("id", userId);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error removing FCM token:", error);
    res.status(500).json({ error: "Failed to remove device token" });
  }
});

// POST /notifications/send — Send a push notification (internal/admin use)
router.post("/notifications/send", verifyToken, async (req, res) => {
  try {
    const { user_id, title, body, data } = req.body;

    if (!user_id || !body) {
      return res.status(400).json({ error: "user_id and body are required" });
    }

    // Get all device tokens for the target user
    const { data: tokens, error: tokenError } = await supabase
      .from("device_tokens")
      .select("token")
      .eq("user_id", user_id);

    let fcmTokens = [];

    if (!tokenError && tokens && tokens.length > 0) {
      fcmTokens = tokens.map((t) => t.token);
    } else {
      // Fallback to users.fcm_token
      const { data: user } = await supabase
        .from("users")
        .select("fcm_token")
        .eq("id", user_id)
        .single();

      if (user?.fcm_token) {
        fcmTokens = [user.fcm_token];
      }
    }

    if (fcmTokens.length === 0) {
      return res.status(404).json({ error: "No device tokens found for user" });
    }

    // Send to all registered devices
    const message = {
      notification: {
        title: title || "RollMate",
        body,
      },
      data: data || {},
    };

    const results = await Promise.allSettled(
      fcmTokens.map((token) => admin.messaging().send({ ...message, token })),
    );

    // Clean up invalid tokens
    const invalidTokens = [];
    results.forEach((result, index) => {
      if (
        result.status === "rejected" &&
        (result.reason?.code ===
          "messaging/registration-token-not-registered" ||
          result.reason?.code === "messaging/invalid-registration-token")
      ) {
        invalidTokens.push(fcmTokens[index]);
      }
    });

    if (invalidTokens.length > 0) {
      await supabase.from("device_tokens").delete().in("token", invalidTokens);
    }

    const sent = results.filter((r) => r.status === "fulfilled").length;
    res.json({ success: true, sent, total: fcmTokens.length });
  } catch (error) {
    console.error("Error sending push notification:", error);
    res.status(500).json({ error: "Failed to send notification" });
  }
});

module.exports = router;
