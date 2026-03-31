const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");

// GET /custom-techniques — Returns custom techniques for the current user's belt
router.get("/custom-techniques", verifyToken, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from("users")
      .select("belt")
      .eq("id", req.user.uid)
      .single();

    const belt = user?.belt || "white";

    const { data, error } = await supabase
      .from("custom_techniques")
      .select("technique_id, name, category, description")
      .eq("user_id", req.user.uid)
      .eq("belt", belt)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json({ techniques: data || [] });
  } catch (error) {
    console.error("Error fetching custom techniques:", error);
    res.status(500).json({ error: "Failed to fetch custom techniques" });
  }
});

// POST /custom-techniques — Add a custom technique
router.post("/custom-techniques", verifyToken, async (req, res) => {
  try {
    const { technique_id, name, category, description, belt } = req.body;

    if (!technique_id || !name || !category || !belt) {
      return res
        .status(400)
        .json({ error: "technique_id, name, category, and belt required" });
    }

    const { data, error } = await supabase
      .from("custom_techniques")
      .insert({
        user_id: req.user.uid,
        belt,
        technique_id,
        name,
        category,
        description: description || "",
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    console.error("Error adding custom technique:", error);
    res.status(500).json({ error: "Failed to add custom technique" });
  }
});

// DELETE /custom-techniques/:techniqueId — Remove a custom technique
router.delete(
  "/custom-techniques/:techniqueId",
  verifyToken,
  async (req, res) => {
    try {
      const { error } = await supabase
        .from("custom_techniques")
        .delete()
        .eq("user_id", req.user.uid)
        .eq("technique_id", req.params.techniqueId);

      if (error) throw error;

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting custom technique:", error);
      res.status(500).json({ error: "Failed to delete custom technique" });
    }
  },
);

module.exports = router;
