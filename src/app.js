const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const cron = require("node-cron");

const routes = require("./routes");
const errorHandler = require("./middleware/errorHandler");
const { fetchAndPostBJJNews, purgeOldNewsPosts } = require("./services/rss");

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

module.exports = app;
