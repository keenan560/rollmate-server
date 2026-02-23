const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");

// Get achievements for a user
router.get("/achievements/:userId", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.uid;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from("achievements")
      .select("*, users!inner(first_name, last_name, avatar_url, belt)", {
        count: "exact",
      })
      .eq("user_id", userId)
      .order("competition_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const achievementIds = data.map((a) => a.id);
    const { data: verifications } = await supabase
      .from("achievement_verifications")
      .select("achievement_id")
      .in("achievement_id", achievementIds)
      .eq("verifier_user_id", currentUserId);

    const verifiedIds = new Set(
      verifications?.map((v) => v.achievement_id) || [],
    );

    const achievements = data.map((a) => ({
      ...a,
      user_first_name: a.users.first_name,
      user_last_name: a.users.last_name,
      user_avatar_url: a.users.avatar_url,
      user_belt: a.users.belt,
      is_verified_by_current_user: verifiedIds.has(a.id),
    }));

    res.json({ achievements, total: count, page, limit });
  } catch (error) {
    console.error("Error fetching achievements:", error);
    res.status(500).json({ error: "Failed to fetch achievements" });
  }
});

// Create achievement
router.post("/achievements", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const achievementData = {
      user_id: currentUserId,
      ...req.body,
    };

    const { data, error } = await supabase
      .from("achievements")
      .insert(achievementData)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ achievement: data });
  } catch (error) {
    console.error("Error creating achievement:", error);
    res.status(500).json({ error: "Failed to create achievement" });
  }
});

// Update achievement
router.put("/achievements/:achievementId", verifyToken, async (req, res) => {
  try {
    const { achievementId } = req.params;
    const currentUserId = req.user.uid;

    const { data, error } = await supabase
      .from("achievements")
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq("id", achievementId)
      .eq("user_id", currentUserId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Achievement not found" });

    res.json({ achievement: data });
  } catch (error) {
    console.error("Error updating achievement:", error);
    res.status(500).json({ error: "Failed to update achievement" });
  }
});

// Delete achievement
router.delete("/achievements/:achievementId", verifyToken, async (req, res) => {
  try {
    const { achievementId } = req.params;
    const currentUserId = req.user.uid;

    const { error } = await supabase
      .from("achievements")
      .delete()
      .eq("id", achievementId)
      .eq("user_id", currentUserId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting achievement:", error);
    res.status(500).json({ error: "Failed to delete achievement" });
  }
});

// Verify/Endorse achievement
router.post(
  "/achievements/:achievementId/verify",
  verifyToken,
  async (req, res) => {
    try {
      const { achievementId } = req.params;
      const currentUserId = req.user.uid;
      const { relationship_type, comment } = req.body;

      const { data, error } = await supabase
        .from("achievement_verifications")
        .insert({
          achievement_id: achievementId,
          verifier_user_id: currentUserId,
          relationship_type,
          comment,
        })
        .select()
        .single();

      if (error) throw error;

      const { data: achievement } = await supabase
        .from("achievements")
        .select("*")
        .eq("id", achievementId)
        .single();

      res.json({ verification: data, achievement });
    } catch (error) {
      console.error("Error verifying achievement:", error);
      res.status(500).json({ error: "Failed to verify achievement" });
    }
  },
);

// Unverify/Remove endorsement from achievement
router.delete(
  "/achievements/:achievementId/verify",
  verifyToken,
  async (req, res) => {
    try {
      const { achievementId } = req.params;
      const currentUserId = req.user.uid;

      const { error } = await supabase
        .from("achievement_verifications")
        .delete()
        .eq("achievement_id", achievementId)
        .eq("verifier_user_id", currentUserId);

      if (error) throw error;

      const { data: achievement } = await supabase
        .from("achievements")
        .select("*")
        .eq("id", achievementId)
        .single();

      res.json({ achievement });
    } catch (error) {
      console.error("Error unverifying achievement:", error);
      res.status(500).json({ error: "Failed to unverify achievement" });
    }
  },
);

// Get verifications/endorsements for achievement
router.get(
  "/achievements/:achievementId/verifications",
  verifyToken,
  async (req, res) => {
    try {
      const { achievementId } = req.params;

      const { data, error } = await supabase
        .from("achievement_verifications")
        .select("*, users!inner(first_name, last_name, avatar_url, belt)")
        .eq("achievement_id", achievementId)
        .order("verified_at", { ascending: false });

      if (error) throw error;

      const verifications = data.map((v) => ({
        ...v,
        verifier_first_name: v.users.first_name,
        verifier_last_name: v.users.last_name,
        verifier_avatar_url: v.users.avatar_url,
        verifier_belt: v.users.belt,
      }));

      res.json({ verifications });
    } catch (error) {
      console.error("Error fetching verifications:", error);
      res.status(500).json({ error: "Failed to fetch verifications" });
    }
  },
);

module.exports = router;
