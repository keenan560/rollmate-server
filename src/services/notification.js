const admin = require("./firebase");
const supabase = require("../../config");

// Get all FCM tokens for a user (multi-device support)
async function getUserFCMTokens(userId) {
  // Try device_tokens table first
  const { data: tokens, error } = await supabase
    .from("device_tokens")
    .select("token")
    .eq("user_id", userId);

  if (!error && tokens && tokens.length > 0) {
    return tokens.map((t) => t.token);
  }

  // Fallback to users.fcm_token column
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("fcm_token")
    .eq("id", userId)
    .single();

  if (userError || !user?.fcm_token) return [];
  return [user.fcm_token];
}

// Legacy single-token getter (backward compat)
async function getUserFCMToken(userId) {
  const tokens = await getUserFCMTokens(userId);
  return tokens.length > 0 ? tokens[0] : null;
}

// Send push notification to a user (all their devices)
async function sendNotification(userId, message, options = {}) {
  try {
    const fcmTokens = await getUserFCMTokens(userId);

    if (fcmTokens.length === 0) {
      console.log(`No FCM tokens found for user ${userId}`);
      return { sent: 0 };
    }

    const { title = "RollMate", data = {}, badge } = options;

    const payload = {
      notification: {
        title,
        body: message,
      },
      data: {
        ...data,
        // Ensure all data values are strings (FCM requirement)
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)]),
        ),
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            ...(badge !== undefined && { badge }),
          },
        },
      },
    };

    const results = await Promise.allSettled(
      fcmTokens.map((token) => admin.messaging().send({ ...payload, token })),
    );

    // Clean up invalid/expired tokens
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

      console.log(`Cleaned up ${invalidTokens.length} invalid FCM tokens`);
    }

    const sent = results.filter((r) => r.status === "fulfilled").length;
    console.log(
      `Notification sent to ${sent}/${fcmTokens.length} devices for user ${userId}`,
    );

    return { sent, total: fcmTokens.length };
  } catch (error) {
    console.error("Error sending notification:", error);
    return { sent: 0, error: error.message };
  }
}

// Send push to multiple users at once
async function sendNotificationToMany(userIds, message, options = {}) {
  const results = await Promise.allSettled(
    userIds.map((userId) => sendNotification(userId, message, options)),
  );

  return results.map((r, i) => ({
    userId: userIds[i],
    ...(r.status === "fulfilled" ? r.value : { sent: 0, error: r.reason }),
  }));
}

module.exports = {
  sendNotification,
  sendNotificationToMany,
  getUserFCMToken,
  getUserFCMTokens,
};
