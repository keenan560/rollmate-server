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

module.exports = app;
