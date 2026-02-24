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

    let query = supabase
      .from("users")
      .select(
        "id, first_name, last_name, email, avatar_url, primary_gym, gender, age, weight, belt, stripes, height, style_preference, competition_experience, bjj_start_year, city, location, dob, is_instructor",
      )
      .neq("id", currentUserId);

    if (belt) {
      query = query.ilike("belt", belt);
    }

    if (gender) {
      query = query.ilike("gender", gender);
    }

    if (age) {
      const ageNum = parseInt(age, 10);
      const minAge = ageNum - 5;
      const maxAge = ageNum + 5;
      query = query.gte("age", minAge).lte("age", maxAge);
    }

    if (weight) {
      const weightNum = parseInt(weight, 10);
      const minWeight = weightNum - 15;
      const maxWeight = weightNum + 15;
      query = query.gte("weight", minWeight).lte("weight", maxWeight);
    }

    if (name) {
      query = query.or(`first_name.ilike.%${name}%,last_name.ilike.%${name}%`);
    }

    query = query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error } = await query;

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
  const { userId } = req.params;

  const { data, error } = await supabase
    .from("users")
    .select(
      "id, first_name, last_name, email, avatar_url, primary_gym, gender, age, weight, belt, stripes, height, style_preference, competition_experience, bjj_start_year, city, location, dob, is_instructor",
    )
    .eq("id", userId)
    .single();

  if (error) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json(data);
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
      // ← ADD THIS LINE
      updates.is_instructor = updateData.is_instructor; // ← ADD THIS LINE
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

// Delete user
router.post("/deleteUser", verifyToken, async (req, res, next) => {
  console.log("DELETE USER", req.user);
  try {
    const { data, error } = await supabase
      .from("users")
      .delete()
      .eq("id", req.user.uid)
      .select();

    if (error) throw error;
    console.log("DELETE USER DATA ", data);
    res.status(200).json({ message: "Deleted user successfully", data });
  } catch (error) {
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
