const admin = require("./firebase");
const supabase = require("../../config");

// Helper function to get user's FCM token from database
async function getUserFCMToken(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("fcm_token")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data?.fcm_token;
}

// Helper function to send push notifications
async function sendNotification(userId, message) {
  try {
    const fcmToken = await getUserFCMToken(userId);
    if (!fcmToken) {
      console.log(`No FCM token found for user ${userId}`);
      return;
    }
    const notificationMessage = {
      notification: {
        title: "RollMate",
        body: message,
      },
      token: fcmToken,
    };
    await admin.messaging().send(notificationMessage);
    console.log("Notification sent successfully to user:", userId);
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}

module.exports = { sendNotification, getUserFCMToken };
