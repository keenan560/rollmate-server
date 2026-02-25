const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");

// Helper function to check and auto-verify belt
async function checkAndAutoVerifyBelt(userId) {
  try {
    // Get user's current belt
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("belt, belt_verified")
      .eq("id", userId)
      .single();

    if (userError || !user || user.belt_verified) return false;

    // Get endorsements for current belt
    const { data: endorsements, error: endorseError } = await supabase
      .from("belt_endorsements")
      .select("*, endorser:users!endorser_user_id(is_instructor)")
      .eq("user_id", userId)
      .eq("belt_level", user.belt);

    if (endorseError) throw endorseError;

    // Count instructor and community endorsements
    const instructorCount = endorsements.filter(
      (e) => e.endorser?.is_instructor,
    ).length;
    const communityCount = endorsements.filter(
      (e) => !e.endorser?.is_instructor,
    ).length;

    console.log(
      `User ${userId} belt ${user.belt}: ${instructorCount} instructor, ${communityCount} community endorsements`,
    );

    // Auto-verify if threshold met: 1 instructor OR 3 community members
    if (instructorCount >= 1 || communityCount >= 3) {
      await supabase
        .from("users")
        .update({
          belt_verified: true,
          belt_verified_at: new Date().toISOString(),
        })
        .eq("id", userId);

      console.log(`Belt auto-verified for user ${userId}!`);
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error in checkAndAutoVerifyBelt:", error);
    return false;
  }
}

// Get belt endorsements for a user
router.get(
  "/users/:userId/belt-endorsements",
  verifyToken,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const currentUserId = req.user.uid;

      // Get user's current belt
      const { data: user } = await supabase
        .from("users")
        .select("belt")
        .eq("id", userId)
        .single();

      if (!user || !user.belt) {
        return res.json({
          endorsements: [],
          count: 0,
          is_endorsed_by_current_user: false,
        });
      }

      // Get endorsements for current belt level
      const { data: endorsements, error } = await supabase
        .from("belt_endorsements")
        .select(
          `
        id,
        endorser_user_id,
        belt_level,
        created_at,
        endorser:users!endorser_user_id(
          id,
          first_name,
          last_name,
          avatar_url,
          is_instructor
        )
      `,
        )
        .eq("user_id", userId)
        .eq("belt_level", user.belt)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const isEndorsedByCurrentUser = endorsements.some(
        (e) => e.endorser_user_id === currentUserId,
      );

      res.json({
        endorsements: endorsements || [],
        count: endorsements?.length || 0,
        is_endorsed_by_current_user: isEndorsedByCurrentUser,
      });
    } catch (error) {
      console.error("Error fetching belt endorsements:", error);
      res.status(500).json({
        error: "Failed to fetch belt endorsements",
        message: error.message,
      });
    }
  },
);

// Endorse a user's belt
router.post(
  "/users/:userId/belt-endorsements",
  verifyToken,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const currentUserId = req.user.uid;

      // Can't endorse yourself
      if (userId === currentUserId) {
        return res.status(403).json({
          error: "Cannot endorse your own belt",
        });
      }

      // Get user's current belt
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("belt, first_name, last_name")
        .eq("id", userId)
        .single();

      if (userError || !user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!user.belt) {
        return res.status(400).json({ error: "User has no belt level set" });
      }

      // Check if already endorsed
      const { data: existing } = await supabase
        .from("belt_endorsements")
        .select("id")
        .eq("user_id", userId)
        .eq("endorser_user_id", currentUserId)
        .eq("belt_level", user.belt)
        .single();

      if (existing) {
        return res.status(400).json({
          error: "You have already endorsed this belt",
        });
      }

      // Create endorsement
      const { data: endorsement, error: endorseError } = await supabase
        .from("belt_endorsements")
        .insert({
          user_id: userId,
          endorser_user_id: currentUserId,
          belt_level: user.belt,
        })
        .select()
        .single();

      if (endorseError) throw endorseError;

      // Check if auto-verification is triggered
      const wasAutoVerified = await checkAndAutoVerifyBelt(userId);

      // Get updated count
      const { data: allEndorsements } = await supabase
        .from("belt_endorsements")
        .select("id")
        .eq("user_id", userId)
        .eq("belt_level", user.belt);

      res.json({
        message: wasAutoVerified
          ? "Endorsement added and belt auto-verified!"
          : "Belt endorsed successfully",
        endorsement,
        count: allEndorsements?.length || 0,
        auto_verified: wasAutoVerified,
      });
    } catch (error) {
      console.error("Error endorsing belt:", error);
      res.status(500).json({
        error: "Failed to endorse belt",
        message: error.message,
      });
    }
  },
);

// Remove belt endorsement
router.delete(
  "/users/:userId/belt-endorsements",
  verifyToken,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const currentUserId = req.user.uid;

      // Get user's current belt
      const { data: user } = await supabase
        .from("users")
        .select("belt")
        .eq("id", userId)
        .single();

      if (!user || !user.belt) {
        return res.status(404).json({ error: "User not found" });
      }

      // Delete endorsement
      const { error: deleteError } = await supabase
        .from("belt_endorsements")
        .delete()
        .eq("user_id", userId)
        .eq("endorser_user_id", currentUserId)
        .eq("belt_level", user.belt);

      if (deleteError) throw deleteError;

      // Check if belt should be unverified
      const { data: userData } = await supabase
        .from("users")
        .select("belt_verified")
        .eq("id", userId)
        .single();

      if (userData?.belt_verified) {
        // Recheck endorsement threshold
        const { data: remainingEndorsements } = await supabase
          .from("belt_endorsements")
          .select("*, endorser:users!endorser_user_id(is_instructor)")
          .eq("user_id", userId)
          .eq("belt_level", user.belt);

        const instructorCount =
          remainingEndorsements?.filter((e) => e.endorser?.is_instructor)
            .length || 0;
        const communityCount =
          remainingEndorsements?.filter((e) => !e.endorser?.is_instructor)
            .length || 0;

        // If no longer meets threshold, unverify
        if (instructorCount < 1 && communityCount < 3) {
          await supabase
            .from("users")
            .update({
              belt_verified: false,
              belt_verified_at: null,
            })
            .eq("id", userId);
        }
      }

      // Get updated count
      const { data: allEndorsements } = await supabase
        .from("belt_endorsements")
        .select("id")
        .eq("user_id", userId)
        .eq("belt_level", user.belt);

      res.json({
        message: "Endorsement removed successfully",
        count: allEndorsements?.length || 0,
      });
    } catch (error) {
      console.error("Error removing endorsement:", error);
      res.status(500).json({
        error: "Failed to remove endorsement",
        message: error.message,
      });
    }
  },
);

module.exports = router;
