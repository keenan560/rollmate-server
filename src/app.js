const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const cron = require("node-cron");

const routes = require("./routes");
const errorHandler = require("./middleware/errorHandler");
const { fetchAndPostBJJNews, purgeOldNewsPosts } = require("./services/rss");
const {
  fetchAndPostCompetitions,
  purgeOldCompetitionPosts,
} = require("./services/competitions");
const { sendNotification } = require("./services/notification");
const supabase = require("../config");

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use("/", routes);

// Error handler (must be last)
app.use(errorHandler);

// Schedule news fetch every 6 hours
cron.schedule("0 */6 * * *", async () => {
  console.log("Running scheduled BJJ news fetch...");
  await fetchAndPostBJJNews();
});

// Run once on server start
setTimeout(() => {
  fetchAndPostBJJNews();
}, 5000);

// Purge old news posts daily at midnight
cron.schedule("0 0 * * *", async () => {
  console.log("Running daily news post cleanup...");
  await purgeOldNewsPosts(30);
});

// Fetch competitions every 12 hours
cron.schedule("0 */12 * * *", async () => {
  console.log("Running scheduled competition fetch...");
  await fetchAndPostCompetitions();
});

// Run competition fetch once on server start (delayed)
setTimeout(() => {
  fetchAndPostCompetitions();
}, 15000);

// Purge old competition posts daily at 1am
cron.schedule("0 1 * * *", async () => {
  console.log("Running competition post cleanup...");
  await purgeOldCompetitionPosts(14);
});

// Purge old notifications daily at 3am (keep unread friend requests)
cron.schedule("0 3 * * *", async () => {
  console.log("Running daily notifications cleanup...");
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { error } = await supabase
    .from("notifications")
    .delete()
    .lt("created_at", thirtyDaysAgo)
    .neq("type", "friend_request");
  if (error) {
    console.error("Error cleaning up notifications:", error);
  } else {
    console.log("Old notifications cleaned up");
  }
});

// Cleanup old events daily at 2am (7 days past event_date)
cron.schedule("0 2 * * *", async () => {
  console.log("Running daily events cleanup...");
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { error } = await supabase
    .from("events")
    .delete()
    .lt("event_date", sevenDaysAgo);
  if (error) {
    console.error("Error cleaning up old events:", error);
  } else {
    console.log("Old events cleaned up");
  }
});

// Training reminders — check every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  try {
    const { data: reminders, error } = await supabase
      .from("training_reminders")
      .select("user_id, days, reminder_time, timezone")
      .eq("enabled", true);

    if (error || !reminders || reminders.length === 0) return;

    for (const reminder of reminders) {
      try {
        // Get current time in user's timezone
        const now = new Date();
        const userTime = new Intl.DateTimeFormat("en-US", {
          timeZone: reminder.timezone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          weekday: "short",
        }).formatToParts(now);

        const hour = userTime.find((p) => p.type === "hour")?.value || "";
        const minute = userTime.find((p) => p.type === "minute")?.value || "";
        const weekday = (
          userTime.find((p) => p.type === "weekday")?.value || ""
        ).toLowerCase();

        const currentTime = `${hour}:${minute}`;
        const dayMap = {
          mon: "mon",
          tue: "tue",
          wed: "wed",
          thu: "thu",
          fri: "fri",
          sat: "sat",
          sun: "sun",
        };
        const currentDay = dayMap[weekday] || weekday.slice(0, 3);

        // Check if current time is within the 5-min cron window
        const [targetH, targetM] = reminder.reminder_time
          .split(":")
          .map(Number);
        const [nowH, nowM] = currentTime.split(":").map(Number);
        const targetMinutes = targetH * 60 + targetM;
        const nowMinutes = nowH * 60 + nowM;
        const diff = nowMinutes - targetMinutes;

        // Only fire if we're within 0-4 minutes past the target time
        if (diff < 0 || diff >= 5) continue;

        // Check if today is in their selected days
        if (!reminder.days.includes(currentDay)) continue;

        // Optional: skip if user already logged today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const { data: todayLogs } = await supabase
          .from("training_logs")
          .select("id")
          .eq("user_id", reminder.user_id)
          .gte("date", todayStart.toISOString())
          .limit(1);

        if (todayLogs && todayLogs.length > 0) continue;

        // Send push notification
        await sendNotification(
          reminder.user_id,
          "Don't forget to log your training session today.",
          {
            title: "Time to train! 🥋",
            data: { type: "session" },
          },
        );
      } catch (userErr) {
        console.error(
          `Error processing reminder for ${reminder.user_id}:`,
          userErr.message,
        );
      }
    }
  } catch (err) {
    console.error("Error in training reminders cron:", err);
  }
});

module.exports = app;
