const express = require("express");
const router = express.Router();
const supabase = require("../../config");

// System/seed accounts that aren't real signups — excluded from any
// public-facing count. Identified by id (the two content-bot accounts use
// readable slugs instead of real Firebase UIDs) or by email (the one
// test@example.com seed account).
const EXCLUDED_USER_IDS = ["competition-bot", "bjj-news-bot"];
const EXCLUDED_EMAILS = ["test@example.com"];

// GET /stats/user-count — public, read-only. Powers the real member count
// shown on the marketing site; never exposes any user data, just a total.
router.get("/stats/user-count", async (req, res) => {
  try {
    const { count, error } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .not("id", "in", `(${EXCLUDED_USER_IDS.join(",")})`)
      .not("email", "in", `(${EXCLUDED_EMAILS.join(",")})`);

    if (error) throw error;

    res.set("Cache-Control", "public, max-age=3600");
    res.json({ count: count ?? 0 });
  } catch (error) {
    console.error("[stats] user-count error:", error.message);
    res.status(500).json({ error: "Failed to fetch user count" });
  }
});

module.exports = router;
