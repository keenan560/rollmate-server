const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const {
  sendNotification,
  sendNotificationToMany,
} = require("../services/notification");

// ============================================
// ACHIEVEMENT CRUD
// ============================================

// Get achievements for a user (UPDATED VERSION - includes endorsements)
router.get("/achievements/:userId", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.uid;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;

    // Fetch achievements with user data
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

    // Check which achievements current user has verified
    const { data: verifications } = await supabase
      .from("achievement_verifications")
      .select("achievement_id")
      .in("achievement_id", achievementIds)
      .eq("verifier_user_id", currentUserId);

    const verifiedIds = new Set(
      verifications?.map((v) => v.achievement_id) || [],
    );

    // Check which achievements current user has endorsed
    const { data: endorsements } = await supabase
      .from("achievement_endorsements")
      .select("achievement_id")
      .in("achievement_id", achievementIds)
      .eq("endorser_user_id", currentUserId);

    const endorsedIds = new Set(
      endorsements?.map((e) => e.achievement_id) || [],
    );

    // Map achievements with all info
    const achievements = data.map((a) => ({
      ...a,
      user_first_name: a.users.first_name,
      user_last_name: a.users.last_name,
      user_avatar_url: a.users.avatar_url,
      user_belt: a.users.belt,
      is_verified_by_current_user: verifiedIds.has(a.id),
      is_endorsed_by_current_user: endorsedIds.has(a.id),
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

    // Notify friends (fire and forget)
    supabase
      .from("users")
      .select("first_name, last_name, avatar_url")
      .eq("id", currentUserId)
      .single()
      .then(({ data: user }) => {
        if (!user) return;
        return supabase
          .from("roll_requests")
          .select("sender_id, receiver_id")
          .eq("status", "accepted")
          .or(`sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`)
          .then(async ({ data: friends }) => {
            const friendIds = (friends || []).map((f) =>
              f.sender_id === currentUserId ? f.receiver_id : f.sender_id,
            );
            if (friendIds.length === 0) return;
            const notifications = friendIds.map((fid) => ({
              user_id: fid,
              type: "achievement",
              title: `${user.first_name} added an achievement 🏆`,
              body: data.competition_name || "New competition result",
              actor_id: currentUserId,
              actor_name: `${user.first_name} ${user.last_name}`,
              actor_avatar: user.avatar_url,
              reference_id: data.id,
            }));
            await supabase.from("notifications").insert(notifications);

            // Send push notifications to friends
            sendNotificationToMany(
              friendIds,
              data.competition_name || "New competition result",
              {
                title: `${user.first_name} earned an achievement 🏆`,
                data: {
                  type: "achievement",
                  achievement_id: String(data.id),
                  user_id: currentUserId,
                  user_name: `${user.first_name} ${user.last_name}`,
                },
              },
            ).catch((err) => console.error("Achievement push error:", err));
          });
      })
      .catch((err) =>
        console.error("Error sending achievement notifications:", err),
      );

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

// ============================================
// ACHIEVEMENT VERIFICATIONS (Legacy)
// ============================================

// Verify achievement
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

// Unverify achievement
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

// Get verifications for achievement
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

// ============================================
// ACHIEVEMENT ENDORSEMENTS (LinkedIn-style)
// ============================================

// Endorse achievement
router.post(
  "/achievements/:achievementId/endorse",
  verifyToken,
  async (req, res) => {
    try {
      const { achievementId } = req.params;
      const currentUserId = req.user.uid;
      const { relationship_type, comment } = req.body;

      // Check if user is trying to endorse their own achievement
      const { data: achievement } = await supabase
        .from("achievements")
        .select("user_id")
        .eq("id", achievementId)
        .single();

      if (achievement?.user_id === currentUserId) {
        return res
          .status(400)
          .json({ error: "Cannot endorse your own achievement" });
      }

      // Insert endorsement
      const { data: endorsement, error } = await supabase
        .from("achievement_endorsements")
        .insert({
          achievement_id: achievementId,
          endorser_user_id: currentUserId,
          relationship_type,
          comment,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          // Unique constraint violation
          return res
            .status(400)
            .json({ error: "You have already endorsed this achievement" });
        }
        throw error;
      }

      // Get updated achievement with new endorsement count
      const { data: updatedAchievement } = await supabase
        .from("achievements")
        .select("*")
        .eq("id", achievementId)
        .single();

      // Send push notification to achievement owner (fire and forget)
      if (achievement?.user_id !== currentUserId) {
        const { data: endorser } = await supabase
          .from("users")
          .select("first_name, last_name")
          .eq("id", currentUserId)
          .single();

        if (endorser) {
          sendNotification(
            achievement.user_id,
            `${endorser.first_name} ${endorser.last_name} endorsed your achievement`,
            {
              title: "New Endorsement 🤝",
              data: {
                type: "endorsement",
                achievement_id: String(achievementId),
                user_id: currentUserId,
                user_name: `${endorser.first_name} ${endorser.last_name}`,
              },
            },
          ).catch((err) => console.error("Endorsement push error:", err));
        }
      }

      res.json({ endorsement, achievement: updatedAchievement });
    } catch (error) {
      console.error("Error endorsing achievement:", error);
      res.status(500).json({ error: "Failed to endorse achievement" });
    }
  },
);

// Remove endorsement
router.delete(
  "/achievements/:achievementId/endorse",
  verifyToken,
  async (req, res) => {
    try {
      const { achievementId } = req.params;
      const currentUserId = req.user.uid;

      const { error } = await supabase
        .from("achievement_endorsements")
        .delete()
        .eq("achievement_id", achievementId)
        .eq("endorser_user_id", currentUserId);

      if (error) throw error;

      // Get updated achievement with new endorsement count
      const { data: achievement } = await supabase
        .from("achievements")
        .select("*")
        .eq("id", achievementId)
        .single();

      res.json({ success: true, achievement });
    } catch (error) {
      console.error("Error removing endorsement:", error);
      res.status(500).json({ error: "Failed to remove endorsement" });
    }
  },
);

// Get endorsements for achievement
router.get(
  "/achievements/:achievementId/endorsements",
  verifyToken,
  async (req, res) => {
    try {
      const { achievementId } = req.params;

      const { data, error } = await supabase
        .from("achievement_endorsements")
        .select("*, users!inner(first_name, last_name, avatar_url, belt)")
        .eq("achievement_id", achievementId)
        .order("endorsed_at", { ascending: false });

      if (error) throw error;

      const endorsements = data.map((e) => ({
        ...e,
        endorser_first_name: e.users.first_name,
        endorser_last_name: e.users.last_name,
        endorser_avatar_url: e.users.avatar_url,
        endorser_belt: e.users.belt,
      }));

      res.json({ endorsements, total: endorsements.length });
    } catch (error) {
      console.error("Error fetching endorsements:", error);
      res.status(500).json({ error: "Failed to fetch endorsements" });
    }
  },
);

// ============================================
// BELT VERIFICATION SYSTEM
// ============================================

// Create belt verification request
router.post("/belt-verifications", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const {
      belt_level,
      stripes,
      verifier_user_id,
      verifier_role,
      gym_name,
      promotion_date,
      notes,
    } = req.body;

    const { data, error } = await supabase
      .from("belt_verifications")
      .insert({
        user_id: currentUserId,
        belt_level,
        stripes: stripes || 0,
        verifier_user_id,
        verifier_role,
        gym_name,
        promotion_date: promotion_date || new Date().toISOString(),
        notes,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ verification: data });
  } catch (error) {
    console.error("Error creating belt verification:", error);
    res.status(500).json({ error: "Failed to create belt verification" });
  }
});

// Update belt verification (only unverified)
router.put(
  "/belt-verifications/:verificationId",
  verifyToken,
  async (req, res) => {
    try {
      const { verificationId } = req.params;
      const currentUserId = req.user.uid;

      const { data, error } = await supabase
        .from("belt_verifications")
        .update({
          ...req.body,
          updated_at: new Date().toISOString(),
        })
        .eq("id", verificationId)
        .eq("user_id", currentUserId)
        .eq("is_verified", false) // Can only update unverified
        .select()
        .single();

      if (error) throw error;
      if (!data)
        return res
          .status(404)
          .json({ error: "Verification not found or already verified" });

      res.json({ verification: data });
    } catch (error) {
      console.error("Error updating belt verification:", error);
      res.status(500).json({ error: "Failed to update belt verification" });
    }
  },
);

// Verify belt promotion (instructor only)
router.post(
  "/belt-verifications/:verificationId/verify",
  verifyToken,
  async (req, res) => {
    try {
      const { verificationId } = req.params;
      const currentUserId = req.user.uid;
      const { is_verified, notes } = req.body;

      // Get the verification to check if current user is the verifier
      const { data: verification } = await supabase
        .from("belt_verifications")
        .select("*")
        .eq("id", verificationId)
        .single();

      if (!verification) {
        return res.status(404).json({ error: "Verification not found" });
      }

      if (verification.verifier_user_id !== currentUserId) {
        return res
          .status(403)
          .json({ error: "Only the assigned verifier can approve this" });
      }

      // Update verification
      const { data: updatedVerification, error } = await supabase
        .from("belt_verifications")
        .update({
          is_verified,
          verified_at: is_verified ? new Date().toISOString() : null,
          notes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", verificationId)
        .select()
        .single();

      if (error) throw error;

      // If verified, update user's belt info
      let userData = null;
      if (is_verified) {
        const { data: user, error: userError } = await supabase
          .from("users")
          .update({
            belt: verification.belt_level,
            stripes: verification.stripes,
            belt_verified: true,
            belt_verified_at: new Date().toISOString(),
            belt_verified_by: currentUserId,
          })
          .eq("id", verification.user_id)
          .select("belt, stripes, belt_verified, belt_verified_at")
          .single();

        if (userError) throw userError;
        userData = user;
      }

      res.json({ verification: updatedVerification, user: userData });
    } catch (error) {
      console.error("Error verifying belt promotion:", error);
      res.status(500).json({ error: "Failed to verify belt promotion" });
    }
  },
);

// Get belt verifications for a user
router.get("/belt-verifications/:userId", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from("belt_verifications")
      .select(
        "*, verifier:users!belt_verifications_verifier_user_id_fkey(first_name, last_name, avatar_url, belt)",
      )
      .eq("user_id", userId)
      .order("promotion_date", { ascending: false });

    if (error) throw error;

    const verifications = data.map((v) => ({
      ...v,
      verifier_first_name: v.verifier?.first_name,
      verifier_last_name: v.verifier?.last_name,
      verifier_avatar_url: v.verifier?.avatar_url,
    }));

    res.json({ verifications });
  } catch (error) {
    console.error("Error fetching belt verifications:", error);
    res.status(500).json({ error: "Failed to fetch belt verifications" });
  }
});

// Delete belt verification (only unverified)
router.delete(
  "/belt-verifications/:verificationId",
  verifyToken,
  async (req, res) => {
    try {
      const { verificationId } = req.params;
      const currentUserId = req.user.uid;

      const { error } = await supabase
        .from("belt_verifications")
        .delete()
        .eq("id", verificationId)
        .eq("user_id", currentUserId)
        .eq("is_verified", false); // Can only delete unverified

      if (error) throw error;

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting belt verification:", error);
      res.status(500).json({ error: "Failed to delete belt verification" });
    }
  },
);

module.exports = router;
