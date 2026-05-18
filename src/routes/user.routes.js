const express = require("express");
const router = express.Router();
const fs = require("fs");
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { profilePicUpload } = require("../middleware/upload");
const { optimizeUserImages } = require("../utils/imageOptimization");

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

    // If no data, user doesn't exist
    if (!data) {
      return res.status(200).json({ exists: false });
    }

    // Extract coordinates from PostGIS geometry if location exists
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

    // Return user data with exists flag
    res.status(200).json({ exists: true, ...data });
  } catch (error) {
    next(error);
  }
});

// Registration endpoint
router.post("/register", verifyToken, async (req, res, next) => {
  console.log("Received request body:", req.body);
  try {
    // Location is optional - app must be fully functional without it (App Store guideline 5.1.5)
    const location =
      req.body.location && req.body.location.lat && req.body.location.lng
        ? req.body.location
        : null;

    let avatarUrl = req.user.picture;
    if (req.body.profilePhoto && req.body.profilePhoto !== req.user.picture) {
      console.log("Using uploaded profile picture URL:", req.body.profilePhoto);
      avatarUrl = req.body.profilePhoto;
    }

    const locationPoint = location
      ? `POINT(${location.lng} ${location.lat})`
      : null;
    const weightRangeMin = req.body.weight - 20;
    const weightRangeMax = req.body.weight + 20;

    const userData = {
      id: req.user.uid,
      first_name: req.body.first_name,
      last_name: req.body.last_name,
      email: req.user.email,
      avatar_url: avatarUrl,
      gender: req.body.gender || null,
      age: req.body.age || 0,
      weight: req.body.weight,
      belt: req.body.belt,
      stripes: parseInt(req.body.stripes) || 0,
      bjj_start_year: req.body.bjj_start_year,
      height: req.body.height,
      dob: req.body.dob || null,
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
      city: location ? location.city || "Unknown" : null,
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

// Helper function to get blocked user IDs
async function getBlockedUserIds(userId) {
  const { data, error } = await supabase
    .from("blocked_users")
    .select("blocked_user_id")
    .or(`user_id.eq.${userId},blocked_user_id.eq.${userId}`);

  if (error) {
    console.error("Error fetching blocked users:", error);
    return [];
  }

  // Return IDs of users who blocked me OR users I blocked
  return data.map((b) => b.blocked_user_id);
}

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

    // Get blocked user IDs
    const blockedIds = await getBlockedUserIds(currentUserId);

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

    // Filter out blocked users
    let filteredData = data.filter((user) => !blockedIds.includes(user.id));

    // Filter out private users who aren't friends
    const { data: friendships } = await supabase
      .from("roll_requests")
      .select("sender_id, receiver_id")
      .eq("status", "accepted")
      .or(`sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`);

    const friendSet = new Set(
      (friendships || []).map((f) =>
        f.sender_id === currentUserId ? f.receiver_id : f.sender_id,
      ),
    );

    filteredData = filteredData.filter(
      (user) =>
        user.id === currentUserId || friendSet.has(user.id) || !user.is_private,
    );

    // Optimize images in all users
    const optimizedUsers = filteredData.map((user) => optimizeUserImages(user));

    console.log(
      `Fetched ${optimizedUsers.length} users for page ${page} (${data.length - filteredData.length} blocked, optimized)`,
    );
    res.json(optimizedUsers);
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
    const currentUserId = req.user.uid;

    // Check if user is blocked
    const { data: blockCheck } = await supabase
      .from("blocked_users")
      .select("id")
      .or(`user_id.eq.${currentUserId},blocked_user_id.eq.${currentUserId}`)
      .or(`user_id.eq.${userId},blocked_user_id.eq.${userId}`)
      .limit(1);

    if (blockCheck && blockCheck.length > 0) {
      return res.status(403).json({
        error: "User not accessible",
        message: "This user is not available",
      });
    }

    const { data, error } = await supabase
      .from("users")
      .select(
        "id, first_name, last_name, email, avatar_url, primary_gym, gender, age, weight, belt, stripes, height, style_preference, competition_experience, bjj_start_year, city, location, dob, is_instructor, belt_verified, friends_count, is_private, current_streak",
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

    // Optimize images
    const optimizedUser = optimizeUserImages(data);
    res.json(optimizedUser);
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

// Toggle privacy setting
router.post("/users/privacy", verifyToken, async (req, res) => {
  try {
    const { is_private } = req.body;

    const { error } = await supabase
      .from("users")
      .update({ is_private: !!is_private })
      .eq("id", req.user.uid);

    if (error) throw error;

    res.json({ is_private: !!is_private });
  } catch (error) {
    console.error("Error updating privacy setting:", error);
    res.status(500).json({ error: "Failed to update privacy setting" });
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

    // 0. Get all user's posts to extract media URLs before deletion
    const { data: userPosts } = await supabase
      .from("posts")
      .select("media_url, media_urls, media_type")
      .eq("user_id", userId);

    // Extract all media file paths from posts
    const mediaFilesToDelete = [];
    if (userPosts) {
      for (const post of userPosts) {
        if (post.media_url) {
          // Extract file path from URL
          if (
            post.media_type === "image" &&
            post.media_url.includes("/post-images/")
          ) {
            const filePath = post.media_url.split("/post-images/")[1];
            mediaFilesToDelete.push({ bucket: "post-images", path: filePath });
          } else if (
            post.media_type === "video" &&
            post.media_url.includes("/post-videos/")
          ) {
            const filePath = post.media_url.split("/post-videos/")[1];
            mediaFilesToDelete.push({ bucket: "post-videos", path: filePath });
          }
        }
        // Handle multiple images
        if (post.media_urls && Array.isArray(post.media_urls)) {
          for (const url of post.media_urls) {
            if (url.includes("/post-images/")) {
              const filePath = url.split("/post-images/")[1];
              mediaFilesToDelete.push({
                bucket: "post-images",
                path: filePath,
              });
            }
          }
        }
      }
    }

    // Get user's profile picture
    const { data: userData } = await supabase
      .from("users")
      .select("avatar_url")
      .eq("id", userId)
      .single();

    if (
      userData?.avatar_url &&
      userData.avatar_url.includes("/profile-pics/")
    ) {
      const filePath = userData.avatar_url.split("/profile-pics/")[1];
      mediaFilesToDelete.push({ bucket: "profile-pics", path: filePath });
    }

    // Get all chat images sent by user
    const { data: chatMessages } = await supabase
      .from("chat_messages")
      .select("image_url")
      .eq("sender_id", userId)
      .not("image_url", "is", null);

    if (chatMessages) {
      for (const message of chatMessages) {
        if (message.image_url && message.image_url.includes("/chat-images/")) {
          const filePath = message.image_url.split("/chat-images/")[1];
          mediaFilesToDelete.push({ bucket: "chat-images", path: filePath });
        }
      }
    }

    console.log(`Found ${mediaFilesToDelete.length} media files to delete`);

    // 1. Nullify reply references to this user's messages, then delete
    const { data: userMessageIds } = await supabase
      .from("chat_messages")
      .select("id")
      .eq("sender_id", userId);
    if (userMessageIds && userMessageIds.length > 0) {
      const ids = userMessageIds.map((m) => m.id);
      const { error: nullifyError } = await supabase
        .from("chat_messages")
        .update({ reply_to_id: null })
        .in("reply_to_id", ids);
      if (nullifyError) throw nullifyError;
    }
    const { error: chatMessagesError } = await supabase
      .from("chat_messages")
      .delete()
      .eq("sender_id", userId);
    if (chatMessagesError) throw chatMessagesError;
    console.log("Deleted chat messages");

    // 1b. Delete deleted_chats records
    const { error: deletedChatsError } = await supabase
      .from("deleted_chats")
      .delete()
      .eq("user_id", userId);
    if (deletedChatsError) throw deletedChatsError;

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

    // 8. Delete training logs (nullify partner refs first)
    const { error: trainingPartnerError } = await supabase
      .from("training_logs")
      .update({ partner_id: null })
      .eq("partner_id", userId);
    if (trainingPartnerError) throw trainingPartnerError;
    const { error: trainingLogsError } = await supabase
      .from("training_logs")
      .delete()
      .eq("user_id", userId);
    if (trainingLogsError) throw trainingLogsError;
    console.log("Deleted training logs");

    // 9. Delete event RSVPs and events
    const { error: eventRsvpsError } = await supabase
      .from("event_rsvps")
      .delete()
      .eq("user_id", userId);
    if (eventRsvpsError) throw eventRsvpsError;
    const { error: eventsError } = await supabase
      .from("events")
      .delete()
      .eq("creator_id", userId);
    if (eventsError) throw eventsError;
    console.log("Deleted events");

    // 10. Delete notifications
    const { error: notificationsError } = await supabase
      .from("notifications")
      .delete()
      .eq("user_id", userId);
    if (notificationsError) throw notificationsError;
    const { error: actorNotificationsError } = await supabase
      .from("notifications")
      .delete()
      .eq("actor_id", userId);
    if (actorNotificationsError) throw actorNotificationsError;
    console.log("Deleted notifications");

    // 11. Delete support tickets
    const { error: supportTicketsError } = await supabase
      .from("support_tickets")
      .delete()
      .eq("user_id", userId);
    if (supportTicketsError) throw supportTicketsError;

    // 12. Delete belt progress and custom techniques
    const { error: beltProgressError } = await supabase
      .from("belt_progress")
      .delete()
      .eq("user_id", userId);
    if (beltProgressError) throw beltProgressError;
    const { error: customTechniquesError } = await supabase
      .from("custom_techniques")
      .delete()
      .eq("user_id", userId);
    if (customTechniquesError) throw customTechniquesError;

    // 13. Delete blocked users
    const { error: blockedUsersError } = await supabase
      .from("blocked_users")
      .delete()
      .or(`user_id.eq.${userId},blocked_user_id.eq.${userId}`);
    if (blockedUsersError) throw blockedUsersError;
    console.log("Deleted remaining user data");

    // 14. Finally, delete the user
    const { data, error } = await supabase
      .from("users")
      .delete()
      .eq("id", userId)
      .select();

    if (error) throw error;

    // 9. Delete all media files from storage
    let deletedFilesCount = 0;
    for (const file of mediaFilesToDelete) {
      try {
        const { error: storageError } = await supabase.storage
          .from(file.bucket)
          .remove([file.path]);

        if (!storageError) {
          deletedFilesCount++;
        } else {
          console.error(
            `Failed to delete ${file.bucket}/${file.path}:`,
            storageError.message,
          );
        }
      } catch (storageErr) {
        console.error(
          `Error deleting file ${file.bucket}/${file.path}:`,
          storageErr,
        );
      }
    }
    console.log(`Deleted ${deletedFilesCount} media files from storage`);

    console.log("DELETE USER DATA ", data);
    res.status(200).json({
      message: "Deleted user and all associated data successfully",
      data,
      deletedMediaFiles: deletedFilesCount,
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

// Toggle online status
router.post("/users/online-status", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { is_online } = req.body;

    if (typeof is_online !== "boolean") {
      return res.status(400).json({
        error: "is_online must be a boolean value",
      });
    }

    console.log(`User ${userId} setting is_online to ${is_online}`);

    const { data, error } = await supabase
      .from("users")
      .update({ is_online })
      .eq("id", userId)
      .select()
      .single();

    if (error) {
      console.error("Error updating online status:", error);
      return res.status(500).json({
        error: "Failed to update online status",
        message: error.message,
      });
    }

    res.json({
      success: true,
      is_online,
      message: is_online
        ? "You are now showing as online"
        : "You are now showing as offline",
    });
  } catch (error) {
    console.error("Error updating online status:", error);
    res.status(500).json({
      error: "Failed to update online status",
      message: error.message,
    });
  }
});

// Get blocked users
router.get("/blocked-users", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    // Get list of blocked user IDs
    const { data: blocks, error: blocksError } = await supabase
      .from("blocked_users")
      .select("blocked_user_id")
      .eq("user_id", userId);

    if (blocksError) throw blocksError;

    if (!blocks || blocks.length === 0) {
      return res.json([]);
    }

    const blockedUserIds = blocks.map((b) => b.blocked_user_id);

    // Get user details for blocked users
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, first_name, last_name, avatar_url, belt, primary_gym")
      .in("id", blockedUserIds);

    if (usersError) throw usersError;

    // Optimize images in blocked users
    const optimizedUsers = (users || []).map((user) =>
      optimizeUserImages(user),
    );

    res.json(optimizedUsers);
  } catch (error) {
    console.error("Error fetching blocked users:", error);
    res.status(500).json({
      error: "Failed to fetch blocked users",
      message: error.message,
    });
  }
});

// Block a user
router.post("/block-user", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { blocked_user_id } = req.body;

    if (!blocked_user_id) {
      return res.status(400).json({
        error: "blocked_user_id is required",
      });
    }

    // Can't block yourself
    if (blocked_user_id === userId) {
      return res.status(400).json({
        error: "You cannot block yourself",
      });
    }

    // Insert block record
    const { data, error } = await supabase
      .from("blocked_users")
      .insert({
        user_id: userId,
        blocked_user_id: blocked_user_id,
      })
      .select()
      .single();

    if (error) {
      // Handle duplicate block (already blocked)
      if (error.code === "23505") {
        return res.status(400).json({
          error: "User is already blocked",
        });
      }
      throw error;
    }

    res.json({
      success: true,
      message: "User blocked successfully",
    });
  } catch (error) {
    console.error("Error blocking user:", error);
    res.status(500).json({
      error: "Failed to block user",
      message: error.message,
    });
  }
});

// Unblock a user
router.post("/unblock-user", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { blocked_user_id } = req.body;

    if (!blocked_user_id) {
      return res.status(400).json({
        error: "blocked_user_id is required",
      });
    }

    const { error } = await supabase
      .from("blocked_users")
      .delete()
      .eq("user_id", userId)
      .eq("blocked_user_id", blocked_user_id);

    if (error) throw error;

    res.json({
      success: true,
      message: "User unblocked successfully",
    });
  } catch (error) {
    console.error("Error unblocking user:", error);
    res.status(500).json({
      error: "Failed to unblock user",
      message: error.message,
    });
  }
});

module.exports = router;
