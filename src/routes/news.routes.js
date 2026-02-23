const express = require("express");
const router = express.Router();
const { fetchAndPostBJJNews } = require("../services/rss");

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

module.exports = router;
