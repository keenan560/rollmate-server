const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");

// GET /belt-progress — Returns checked technique IDs for the current user's belt
router.get("/belt-progress", verifyToken, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from("users")
      .select("belt")
      .eq("id", req.user.uid)
      .single();

    const belt = user?.belt || "white";

    const { data, error } = await supabase
      .from("belt_progress")
      .select("technique_id")
      .eq("user_id", req.user.uid)
      .eq("belt", belt);

    if (error) throw error;

    res.json({ checked: (data || []).map((d) => d.technique_id) });
  } catch (error) {
    console.error("Error fetching belt progress:", error);
    res.status(500).json({ error: "Failed to fetch belt progress" });
  }
});

// POST /belt-progress — Toggle a technique (add or remove)
router.post("/belt-progress", verifyToken, async (req, res) => {
  try {
    const { technique_id, belt } = req.body;

    if (!technique_id || !belt) {
      return res.status(400).json({ error: "technique_id and belt required" });
    }

    // Check if already exists
    const { data: existing } = await supabase
      .from("belt_progress")
      .select("id")
      .eq("user_id", req.user.uid)
      .eq("belt", belt)
      .eq("technique_id", technique_id)
      .single();

    if (existing) {
      await supabase.from("belt_progress").delete().eq("id", existing.id);
      res.json({ checked: false });
    } else {
      await supabase
        .from("belt_progress")
        .insert({ user_id: req.user.uid, belt, technique_id });
      res.json({ checked: true });
    }
  } catch (error) {
    console.error("Error updating belt progress:", error);
    res.status(500).json({ error: "Failed to update belt progress" });
  }
});

module.exports = router;
