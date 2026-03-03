const express = require("express");
const router = express.Router();
const fs = require("fs");
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { profilePicUpload } = require("../middleware/upload");

// Check if user exists
router.get("/check-user", verifyToken, async (req, res, next) => {
  console.log(req.user);
  try {
    const { data, error } = await supabase
      .from("users")
      .select()
      .eq("id", req.user.uid)
      .single();

    if (error && error.code !== "PGRST116") {
      throw error;
    }

    // Extract coordinates from PostGIS geometry if location exists
    if (data && data.location) {
      const { data: coords, error: coordError } = await supabase.rpc(
        "get_coordinates",
        {
          geom: data.location,
        },
      );

      if (!coordError && coords) {
        data.latitude = coords.lat;
        data.longitude = coords.lng;
      }
    }

    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

// Registration endpoint
router.post("/register", verifyToken, async (req, res, next) => {
  console.log("Received request body:", req.body);
  try {
    if (
      !req.body.location ||
      !req.body.location.lat ||
      !req.body.location.lng
    ) {
      return res.status(400).json({
        error: "Location data is required",
        details: "Please provide latitude and longitude coordinates",
      });
    }

    let avatarUrl = req.user.picture;
    if (req.body.profilePhoto && req.body.profilePhoto !== req.user.picture) {
      console.log("Using uploaded profile picture URL:", req.body.profilePhoto);
      avatarUrl = req.body.profilePhoto;
    }

    const locationPoint = `POINT(${req.body.location.lng} ${req.body.location.lat})`;
    const weightRangeMin = req.body.weight - 20;
    const weightRangeMax = req.body.weight + 20;

    const userData = {
      id: req.user.uid,
      first_name: req.body.first_name,
      last_name: req.body.last_name,
      email: req.user.email,
      avatar_url: avatarUrl,
      gender: req.body.gender,
      age: req.body.age || 0,
      weight: req.body.weight,
      belt: req.body.belt,
      stripes: parseInt(req.body.stripes) || 0,
      bjj_start_year: req.body.bjj_start_year,
      height: req.body.height,
      dob: req.body.dob,
      primary_gym: req.body.primary_gym,
      style_preference: "both",
      competition_experience: false,
      is_instructor: req.body.is_instructor || false,
      weight_range_min: weightRangeMin,
      weight_range_max: weightRangeMax,
      is_online: true,
      last_online: new Date().toISOString(),
      looking_for_roll: req.body.looking_for_roll || false,
      available_now: req.body.available_now || false,
      location: locationPoint,
      city: req.body.location.city || "Unknown",
      fcm_token: req.body.fcm_token || null,
    };

    console.log("Prepared user data:", userData);

    const { data, error } = await supabase
      .from("users")
      .insert([userData])
      .select();

    console.log("Supabase response data:", data);

    if (error) {
      console.error("Supabase error:", error);
      throw error;
    }

    const defaultAvailability = [
      {
        user_id: req.user.uid,
        day: "monday",
        morning: false,
        afternoon: false,
        evening: true,
        night: false,
      },
      {
        user_id: req.user.uid,
        day: "tuesday",
        morning: false,
        afternoon: false,
        evening: true,
        night: false,
      },
      {
        user_id: req.user.uid,
        day: "wednesday",
        morning: false,
        afternoon: false,
        evening: true,
        night: false,
      },
      {
        user_id: req.user.uid,
        day: "thursday",
        morning: false,
        afternoon: false,
        evening: true,
        night: false,
      },
      {
        user_id: req.user.uid,
        day: "friday",
        morning: false,
        afternoon: false,
        evening: true,
        night: false,
      },
      {
        user_id: req.user.uid,
        day: "saturday",
        morning: true,
        afternoon: true,
        evening: false,
        night: false,
      },
      {
        user_id: req.user.uid,
        day: "sunday",
        morning: true,
        afternoon: true,
        evening: false,
        night: false,
      },
    ];

    const { error: defaultAvailError } = await supabase
      .from("availability")
      .insert(defaultAvailability);

    if (defaultAvailError) {
      console.error("Error adding default availability:", defaultAvailError);
    }

    res.status(200).json({
      ...data[0],
      profilePictureUploaded: !!(
        req.body.profilePhoto && req.body.profilePhoto !== req.user.picture
      ),
      profilePictureUrl: avatarUrl,
    });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({
      error: "Registration failed",
      details: error.message,
    });
  }
});

// Get all users with filters
router.get("/users", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 30;
    const offset = (page - 1) * limit;
    const { age, weight, belt, gender, name } = req.query;

    console.log("Fetching users with filters:", {
      age,
      weight,
      belt,
      gender,
      name,
      page,
      limit,
    });

    const { data, error } = await supabase.rpc("get_users_with_coords", {
      p_current_user_id: currentUserId,
      p_limit: limit,
      p_offset: offset,
      p_belt: belt || null,
      p_gender: gender || null,
      p_age: age ? parseInt(age, 10) : null,
      p_weight: weight ? parseInt(weight, 10) : null,
      p_name: name || null,
    });

    if (error) {
      console.error("Supabase error fetching users:", error);
      return res.status(500).json({
        error: "Failed to fetch users",
        message: error.message,
      });
    }

    console.log(`Fetched ${data.length} users for page ${page}`);
    res.json(data);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      error: "Failed to fetch users",
      message: error.message,
    });
  }
});

// Get single user
router.get("/users/:userId", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from("users")
      .select(
        "id, first_name, last_name, email, avatar_url, primary_gym, gender, age, weight, belt, stripes, height, style_preference, competition_experience, bjj_start_year, city, location, dob, is_instructor, belt_verified, friends_count",
      )
      .eq("id", userId)
      .single();

    if (error) {
      return res.status(404).json({ error: "User not found" });
    }

    // Extract coordinates from PostGIS geometry using the function
    if (data.location) {
      const { data: coords, error: coordError } = await supabase.rpc(
        "get_coordinates",
        {
          geom: data.location,
        },
      );

      if (!coordError && coords) {
        data.latitude = coords.lat;
        data.longitude = coords.lng;
      }
    }

    res.json(data);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({
      error: "Failed to fetch user",
      message: error.message,
    });
  }
});

// Get user profile
router.get("/user-profile", verifyToken, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select(
        `*,
        availability (day, morning, afternoon, evening, night)`,
      )
      .eq("id", req.user.uid)
      .single();

    if (error) throw error;

    // Extract coordinates from PostGIS geometry if location exists
    if (data && data.location) {
      const { data: coords, error: coordError } = await supabase.rpc(
        "get_coordinates",
        {
          geom: data.location,
        },
      );

      if (!coordError && coords) {
        data.latitude = coords.lat;
        data.longitude = coords.lng;
      }
    }

    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

// Update profile
router.post("/update-profile", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const updateData = req.body;

    console.log("Updating profile for user:", userId);
    console.log("Update data:", updateData);

    const updates = {};
    if (updateData.first_name !== undefined)
      updates.first_name = updateData.first_name;
    if (updateData.last_name !== undefined)
      updates.last_name = updateData.last_name;
    if (updateData.height !== undefined) updates.height = updateData.height;
    if (updateData.weight !== undefined) updates.weight = updateData.weight;
    if (updateData.belt !== undefined) updates.belt = updateData.belt;
    if (updateData.stripes !== undefined) updates.stripes = updateData.stripes;
    if (updateData.experience !== undefined)
      updates.experience = updateData.experience;
    if (updateData.primary_gym !== undefined)
      updates.primary_gym = updateData.primary_gym;
    if (updateData.bjj_start_year !== undefined)
      updates.bjj_start_year = updateData.bjj_start_year;
    if (updateData.avatar_url !== undefined)
      updates.avatar_url = updateData.avatar_url;
    if (updateData.is_instructor !== undefined)
      updates.is_instructor = updateData.is_instructor;

    if (updateData.location && updateData.location.lng !== undefined) {
      updates.location = `POINT(${updateData.location.lng} ${updateData.location.lat})`;
      if (updateData.location.city) updates.city = updateData.location.city;
    }

    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json(data);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// Update playing style preferences
router.put("/profile/playing-style", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const {
      playing_style,
      favorite_submissions,
      favorite_positions,
      training_goals,
    } = req.body;

    const updates = {};
    if (playing_style !== undefined) updates.playing_style = playing_style;
    if (favorite_submissions !== undefined)
      updates.favorite_submissions = favorite_submissions;
    if (favorite_positions !== undefined)
      updates.favorite_positions = favorite_positions;
    if (training_goals !== undefined) updates.training_goals = training_goals;

    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", currentUserId)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, data });
  } catch (error) {
    console.error("Error updating playing style:", error);
    res.status(500).json({ error: "Failed to update playing style" });
  }
});

// Toggle available now status
router.post("/users/available-now", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { available_now } = req.body;

    // Validate input
    if (typeof available_now !== "boolean") {
      return res.status(400).json({
        error: "available_now must be a boolean value",
      });
    }

    console.log(`User ${userId} setting available_now to ${available_now}`);

    // Update user's availability status
    const { data, error } = await supabase
      .from("users")
      .update({ available_now })
      .eq("id", userId)
      .select()
      .single();

    if (error) {
      console.error("Error updating availability:", error);
      return res.status(500).json({
        error: "Failed to update availability",
        message: error.message,
      });
    }

    res.json({
      success: true,
      available_now,
      message: available_now
        ? "You are now showing as available"
        : "You are no longer showing as available",
    });
  } catch (error) {
    console.error("Error updating availability:", error);
    res.status(500).json({
      error: "Failed to update availability",
      message: error.message,
    });
  }
});

// Delete user
router.post("/deleteUser", verifyToken, async (req, res, next) => {
  console.log("DELETE USER", req.user);
  const userId = req.user.uid;

  try {
    // Delete in order to respect foreign key constraints
    console.log(`Starting deletion process for user: ${userId}`);

    // 1. Delete chat messages sent by user
    const { error: chatMessagesError } = await supabase
      .from("chat_messages")
      .delete()
      .eq("sender_id", userId);
    if (chatMessagesError) throw chatMessagesError;
    console.log("Deleted chat messages");

    // 2. Delete chats where user is involved (via roll_requests)
    // First get all roll requests involving this user
    const { data: userRollRequests } = await supabase
      .from("roll_requests")
      .select("id")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);

    if (userRollRequests && userRollRequests.length > 0) {
      const rollRequestIds = userRollRequests.map((rr) => rr.id);
      // Delete chats associated with these roll requests
      const { error: chatsError } = await supabase
        .from("chats")
        .delete()
        .in("roll_request_id", rollRequestIds);
      if (chatsError) throw chatsError;
      console.log("Deleted chats");
    }

    // 3. Delete roll requests
    const { error: rollRequestsError } = await supabase
      .from("roll_requests")
      .delete()
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
    if (rollRequestsError) throw rollRequestsError;
    console.log("Deleted roll requests");

    // 4. Delete post-related data
    const { error: postCommentsError } = await supabase
      .from("post_comments")
      .delete()
      .eq("user_id", userId);
    if (postCommentsError) throw postCommentsError;

    const { error: postLikesError } = await supabase
      .from("post_likes")
      .delete()
      .eq("user_id", userId);
    if (postLikesError) throw postLikesError;

    const { error: photoLikesError } = await supabase
      .from("photo_likes")
      .delete()
      .eq("user_id", userId);
    if (photoLikesError) throw photoLikesError;

    const { error: hiddenPostsError } = await supabase
      .from("hidden_posts")
      .delete()
      .eq("user_id", userId);
    if (hiddenPostsError) throw hiddenPostsError;

    const { error: postReportsError } = await supabase
      .from("post_reports")
      .delete()
      .eq("reported_by", userId);
    if (postReportsError) throw postReportsError;

    const { error: postsError } = await supabase
      .from("posts")
      .delete()
      .eq("user_id", userId);
    if (postsError) throw postsError;
    console.log("Deleted posts and related data");

    // 5. Delete achievement-related data
    const { error: achievementEndorsementsError } = await supabase
      .from("achievement_endorsements")
      .delete()
      .eq("endorser_user_id", userId);
    if (achievementEndorsementsError) throw achievementEndorsementsError;

    const { error: achievementVerificationsError } = await supabase
      .from("achievement_verifications")
      .delete()
      .eq("verifier_user_id", userId);
    if (achievementVerificationsError) throw achievementVerificationsError;

    const { error: achievementsError } = await supabase
      .from("achievements")
      .delete()
      .eq("user_id", userId);
    if (achievementsError) throw achievementsError;
    console.log("Deleted achievements and related data");

    // 6. Delete belt-related data
    const { error: beltEndorsementsError1 } = await supabase
      .from("belt_endorsements")
      .delete()
      .eq("user_id", userId);
    if (beltEndorsementsError1) throw beltEndorsementsError1;

    const { error: beltEndorsementsError2 } = await supabase
      .from("belt_endorsements")
      .delete()
      .eq("endorser_user_id", userId);
    if (beltEndorsementsError2) throw beltEndorsementsError2;

    const { error: beltVerificationEndorsementsError } = await supabase
      .from("belt_verification_endorsements")
      .delete()
      .eq("endorser_user_id", userId);
    if (beltVerificationEndorsementsError)
      throw beltVerificationEndorsementsError;

    const { error: beltVerificationsError1 } = await supabase
      .from("belt_verifications")
      .delete()
      .eq("user_id", userId);
    if (beltVerificationsError1) throw beltVerificationsError1;

    const { error: beltVerificationsError2 } = await supabase
      .from("belt_verifications")
      .delete()
      .eq("verifier_user_id", userId);
    if (beltVerificationsError2) throw beltVerificationsError2;
    console.log("Deleted belt verifications and endorsements");

    // 7. Delete availability
    const { error: availabilityError } = await supabase
      .from("availability")
      .delete()
      .eq("user_id", userId);
    if (availabilityError) throw availabilityError;
    console.log("Deleted availability");

    // 8. Finally, delete the user
    const { data, error } = await supabase
      .from("users")
      .delete()
      .eq("id", userId)
      .select();

    if (error) throw error;

    console.log("DELETE USER DATA ", data);
    res.status(200).json({
      message: "Deleted user and all associated data successfully",
      data,
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    next(error);
  }
});

// Find match
router.get("/find-match", verifyToken, async (req, res, next) => {
  try {
    const { data, error } = await supabase.rpc("find_potential_matches", {
      p_requesting_user_id: req.user.uid,
      p_max_distance: 10000000.0,
    });

    console.log(data);

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(200).json({
        noMatches: true,
        message: "No matches available",
      });
    }

    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

// Profile picture upload
router.post(
  "/profile-pics",
  profilePicUpload.single("file"),
  async (req, res) => {
    try {
      console.log("File upload request received");
      console.log("req.file:", req.file);
      console.log("req.body:", req.body);

      if (!req.file) {
        return res.status(400).json({
          error: "No file uploaded",
          details: "Please select a file to upload",
        });
      }

      const fileBuffer = fs.readFileSync(req.file.path);
      console.log("File read successfully, size:", fileBuffer.length);

      const fileExtension = req.file.originalname.split(".").pop();
      const uniqueFileName = `profile-pic-${Date.now()}-${Math.random()
        .toString(36)
        .substring(7)}.${fileExtension}`;

      const { data, error } = await supabase.storage
        .from("profile-pics")
        .upload(uniqueFileName, fileBuffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });

      fs.unlinkSync(req.file.path);

      if (error) {
        console.error("Supabase storage error:", error);
        return res.status(500).json({
          error: "Failed to upload to storage",
          details: error.message,
        });
      }

      console.log("File uploaded successfully:", data);

      const {
        data: { publicUrl },
      } = supabase.storage.from("profile-pics").getPublicUrl(uniqueFileName);

      res.json({
        message: "File uploaded successfully",
        data: data,
        publicUrl: publicUrl,
      });
    } catch (error) {
      console.error("Error in profile-pics upload:", error);
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (cleanupError) {
          console.error("Error cleaning up temp file:", cleanupError);
        }
      }
      res.status(500).json({
        error: "File upload failed",
        details: error.message,
      });
    }
  },
);

module.exports = router;
