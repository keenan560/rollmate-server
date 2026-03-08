const express = require("express");
const router = express.Router();
const {
  fetchAndPostBJJNews,
  cleanupDuplicatePosts,
} = require("../services/rss");

// Manual endpoint to trigger news fetch
router.get("/fetch-bjj-news", async (req, res) => {
  try {
    const count = await fetchAndPostBJJNews();
    res.json({
      success: true,
      message: `Fetched and posted ${count} news articles`,
    });
  } catch (error) {
    console.error("Error fetching BJJ news:", error);
    res.status(500).json({
      error: "Failed to fetch BJJ news",
      message: error.message,
    });
  }
});

// Manual endpoint to cleanup duplicate posts
router.post("/cleanup-duplicate-news", async (req, res) => {
  try {
    const count = await cleanupDuplicatePosts();
    res.json({
      success: true,
      message: `Cleaned up ${count} duplicate posts`,
      deleted: count,
    });
  } catch (error) {
    console.error("Error cleaning up duplicates:", error);
    res.status(500).json({
      error: "Failed to cleanup duplicates",
      message: error.message,
    });
  }
});

module.exports = router;
