const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");

// Helper function to check and auto-verify
async function checkAndAutoVerify(verificationId) {
  try {
    // Get verification details
    const { data: verification, error: verifyError } = await supabase
      .from("belt_verifications")
      .select("*")
      .eq("id", verificationId)
      .single();

    if (verifyError) throw verifyError;

    // Get endorsements with user details
    const { data: endorsements, error: endorseError } = await supabase
      .from("belt_verification_endorsements")
      .select("*, users!endorser_user_id(is_instructor)")
      .eq("verification_id", verificationId);

    if (endorseError) throw endorseError;

    // Count instructor and community endorsements
    const instructorCount = endorsements.filter(
      (e) => e.is_instructor || e.users?.is_instructor,
    ).length;
    const communityCount = endorsements.filter(
      (e) => !e.is_instructor && !e.users?.is_instructor,
    ).length;

    console.log(
      `Verification ${verificationId}: ${instructorCount} instructor, ${communityCount} community endorsements`,
    );

    // Check if verification requirements are met
    if (instructorCount >= 1 || communityCount >= 2) {
      // Update verification status
      await supabase
        .from("belt_verifications")
        .update({
          status: "verified",
          updated_at: new Date().toISOString(),
        })
        .eq("id", verificationId);

      // Update user's belt verification status
      await supabase
        .from("users")
        .update({
          belt_verified: true,
          belt_verified_at: new Date().toISOString(),
        })
        .eq("id", verification.user_id);

      console.log(`Belt verification ${verificationId} auto-verified!`);
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error in checkAndAutoVerify:", error);
    return false;
  }
}

// Create verification request
router.post("/belt-verifications", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { belt_level, stripes, promotion_date, gym_name, notes } = req.body;

    // Validate required fields
    if (!belt_level || stripes === undefined || !promotion_date || !gym_name) {
      return res.status(400).json({
        error: "Missing required fields",
        details:
          "belt_level, stripes, promotion_date, and gym_name are required",
      });
    }

    console.log("Creating belt verification request for user:", currentUserId);

    const { data, error } = await supabase
      .from("belt_verifications")
      .insert({
        user_id: currentUserId,
        belt_level,
        stripes: parseInt(stripes),
        promotion_date,
        gym_name,
        notes: notes || null,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating belt verification:", error);
      return res.status(500).json({
        error: "Failed to create belt verification",
        message: error.message,
      });
    }

    res.status(201).json({
      message: "Belt verification request created successfully",
      verification: data,
    });
  } catch (error) {
    console.error("Error in POST /belt-verifications:", error);
    res.status(500).json({
      error: "Failed to create belt verification",
      message: error.message,
    });
  }
});

// Get verification requests
router.get("/belt-verifications", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;

    console.log("Fetching belt verifications for user:", currentUserId);

    // Get current user's instructor status
    const { data: currentUser } = await supabase
      .from("users")
      .select("is_instructor")
      .eq("id", currentUserId)
      .single();

    // Get user's own requests with endorsement counts
    const { data: myRequests, error: myError } = await supabase
      .from("belt_verifications")
      .select(
        `
        *,
        endorsements:belt_verification_endorsements(count)
      `,
      )
      .eq("user_id", currentUserId)
      .order("created_at", { ascending: false });

    if (myError) throw myError;

    // Get community requests (excluding user's own)
    const { data: communityRequests, error: communityError } = await supabase
      .from("belt_verifications")
      .select(
        `
        *,
        user:users!user_id(
          id,
          first_name,
          last_name,
          avatar_url,
          is_instructor
        ),
        endorsements:belt_verification_endorsements(
          id,
          endorser_user_id,
          is_instructor
        )
      `,
      )
      .neq("user_id", currentUserId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (communityError) throw communityError;

    // Format my requests with endorsement counts
    const formattedMyRequests = myRequests.map((req) => {
      const endorsementCount = req.endorsements?.[0]?.count || 0;
      return {
        ...req,
        endorsement_count: endorsementCount,
        instructor_endorsement_count: 0, // Will be calculated separately if needed
      };
    });

    // Format community requests with user details and endorsement info
    const formattedCommunityRequests = communityRequests.map((req) => {
      const endorsements = req.endorsements || [];
      const instructorEndorsements = endorsements.filter(
        (e) => e.is_instructor,
      );
      const isEndorsedByCurrentUser = endorsements.some(
        (e) => e.endorser_user_id === currentUserId,
      );

      return {
        id: req.id,
        user_id: req.user_id,
        user_first_name: req.user?.first_name,
        user_last_name: req.user?.last_name,
        user_avatar_url: req.user?.avatar_url,
        user_is_instructor: req.user?.is_instructor || false,
        belt_level: req.belt_level,
        stripes: req.stripes,
        status: req.status,
        endorsement_count: endorsements.length,
        instructor_endorsement_count: instructorEndorsements.length,
        is_endorsed_by_current_user: isEndorsedByCurrentUser,
        promotion_date: req.promotion_date,
        gym_name: req.gym_name,
        notes: req.notes,
        created_at: req.created_at,
      };
    });

    res.json({
      myRequests: formattedMyRequests,
      communityRequests: formattedCommunityRequests,
    });
  } catch (error) {
    console.error("Error in GET /belt-verifications:", error);
    res.status(500).json({
      error: "Failed to fetch belt verifications",
      message: error.message,
    });
  }
});

// Endorse verification
router.post(
  "/belt-verifications/:id/endorse",
  verifyToken,
  async (req, res) => {
    try {
      const currentUserId = req.user.uid;
      const { id: verificationId } = req.params;

      console.log(
        `User ${currentUserId} endorsing verification ${verificationId}`,
      );

      // Get verification details
      const { data: verification, error: verifyError } = await supabase
        .from("belt_verifications")
        .select("*")
        .eq("id", verificationId)
        .single();

      if (verifyError || !verification) {
        return res
          .status(404)
          .json({ error: "Verification request not found" });
      }

      // Check if user is trying to endorse their own request
      if (verification.user_id === currentUserId) {
        return res.status(403).json({
          error: "Cannot endorse your own verification request",
        });
      }

      // Check if already verified
      if (verification.status === "verified") {
        return res.status(400).json({
          error: "This verification request is already verified",
        });
      }

      // Get current user's instructor status
      const { data: currentUser } = await supabase
        .from("users")
        .select("is_instructor")
        .eq("id", currentUserId)
        .single();

      const isInstructor = currentUser?.is_instructor || false;

      // Check if user has already endorsed
      const { data: existingEndorsement } = await supabase
        .from("belt_verification_endorsements")
        .select("id")
        .eq("verification_id", verificationId)
        .eq("endorser_user_id", currentUserId)
        .single();

      if (existingEndorsement) {
        return res.status(400).json({
          error: "You have already endorsed this verification request",
        });
      }

      // Create endorsement
      const { data: endorsement, error: endorseError } = await supabase
        .from("belt_verification_endorsements")
        .insert({
          verification_id: verificationId,
          endorser_user_id: currentUserId,
          is_instructor: isInstructor,
        })
        .select()
        .single();

      if (endorseError) {
        console.error("Error creating endorsement:", endorseError);
        return res.status(500).json({
          error: "Failed to create endorsement",
          message: endorseError.message,
        });
      }

      // Check if auto-verification is triggered
      const wasAutoVerified = await checkAndAutoVerify(verificationId);

      // Get updated verification
      const { data: updatedVerification } = await supabase
        .from("belt_verifications")
        .select("*")
        .eq("id", verificationId)
        .single();

      // Get endorsement counts
      const { data: allEndorsements } = await supabase
        .from("belt_verification_endorsements")
        .select("is_instructor")
        .eq("verification_id", verificationId);

      const instructorCount =
        allEndorsements?.filter((e) => e.is_instructor).length || 0;
      const totalCount = allEndorsements?.length || 0;

      res.json({
        message: wasAutoVerified
          ? "Endorsement added and verification auto-verified!"
          : "Endorsement added successfully",
        verification: {
          ...updatedVerification,
          endorsement_count: totalCount,
          instructor_endorsement_count: instructorCount,
        },
      });
    } catch (error) {
      console.error("Error in POST /belt-verifications/:id/endorse:", error);
      res.status(500).json({
        error: "Failed to endorse verification",
        message: error.message,
      });
    }
  },
);

// Remove endorsement
router.delete(
  "/belt-verifications/:id/endorse",
  verifyToken,
  async (req, res) => {
    try {
      const currentUserId = req.user.uid;
      const { id: verificationId } = req.params;

      console.log(
        `User ${currentUserId} removing endorsement from verification ${verificationId}`,
      );

      // Delete endorsement
      const { error: deleteError } = await supabase
        .from("belt_verification_endorsements")
        .delete()
        .eq("verification_id", verificationId)
        .eq("endorser_user_id", currentUserId);

      if (deleteError) {
        console.error("Error removing endorsement:", deleteError);
        return res.status(500).json({
          error: "Failed to remove endorsement",
          message: deleteError.message,
        });
      }

      // If verification was auto-verified, we might need to revert it
      const { data: verification } = await supabase
        .from("belt_verifications")
        .select("*")
        .eq("id", verificationId)
        .single();

      if (verification?.status === "verified") {
        // Check if it still meets verification requirements
        const { data: remainingEndorsements } = await supabase
          .from("belt_verification_endorsements")
          .select("is_instructor")
          .eq("verification_id", verificationId);

        const instructorCount =
          remainingEndorsements?.filter((e) => e.is_instructor).length || 0;
        const communityCount =
          remainingEndorsements?.filter((e) => !e.is_instructor).length || 0;

        // If no longer meets requirements, revert to pending
        if (instructorCount < 1 && communityCount < 2) {
          await supabase
            .from("belt_verifications")
            .update({
              status: "pending",
              updated_at: new Date().toISOString(),
            })
            .eq("id", verificationId);

          await supabase
            .from("users")
            .update({
              belt_verified: false,
              belt_verified_at: null,
            })
            .eq("id", verification.user_id);
        }
      }

      res.json({
        message: "Endorsement removed successfully",
      });
    } catch (error) {
      console.error("Error in DELETE /belt-verifications/:id/endorse:", error);
      res.status(500).json({
        error: "Failed to remove endorsement",
        message: error.message,
      });
    }
  },
);

module.exports = router;
