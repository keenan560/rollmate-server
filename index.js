const fs = require("fs");
const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
const app = express();
const port = 3001;
const supabase = require("./config");

// Initialize Firebase Admin
const serviceAccount = require("./roll-mate-firebase-adminsdk-dvpro-08ec4a8e36.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middleware
app.use(cors());
app.use(bodyParser.json());

// MULTER CONFIGURATIONS - Create separate instances
// For profile pictures (saves to disk temporarily)
const profilePicUpload = multer({ dest: "uploads/" });

// For chat images (memory storage for direct upload to Supabase)
const chatImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed!"), false);
    }
    cb(null, true);
  },
});

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    error: err.message,
    details: err.details || "No additional details available",
  });
};

// Firebase Auth middleware
const verifyToken = async (req, res, next) => {
  try {
    const idToken = req.headers.authorization?.split("Bearer ")[1];
    if (!idToken) {
      return res.status(401).json({ error: "No token provided" });
    }
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Auth Error:", error);
    res.status(401).json({ error: "Invalid token" });
  }
};

// Helper function to get user's FCM token from database
async function getUserFCMToken(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("fcm_token")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data?.fcm_token;
}

// Helper function to send push notifications
async function sendNotification(userId, message) {
  try {
    const fcmToken = await getUserFCMToken(userId);
    if (!fcmToken) {
      console.log(`No FCM token found for user ${userId}`);
      return;
    }
    const notificationMessage = {
      notification: {
        title: "RollMate",
        body: message,
      },
      token: fcmToken,
    };
    await admin.messaging().send(notificationMessage);
    console.log("Notification sent successfully to user:", userId);
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}

app.post("/profile-pics", profilePicUpload.single("file"), async (req, res) => {
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
});

// Login endpoint - update user status
app.post("/login", verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .update({
        is_online: true,
        last_online: new Date().toISOString(),
      })
      .eq("id", req.user.uid)
      .select();

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

// Check if user exists
app.get("/check-user", verifyToken, async (req, res, next) => {
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

// Registration endpoint with profile picture upload
app.post("/register", verifyToken, async (req, res, next) => {
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

// Update your /users endpoint in the server to handle filters
// Replace your existing /users endpoint with this:

app.get("/users", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 30;
    const offset = (page - 1) * limit;

    // Get filter parameters
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

    // Start building the Supabase query
    let query = supabase
      .from("users")
      .select(
        "id, first_name, last_name, email, avatar_url, primary_gym, gender, age, weight, belt, stripes, height, style_preference, competition_experience, bjj_start_year, city, location, dob",
      )
      .neq("id", currentUserId);

    // Apply filters
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

    // Apply name search filter
    if (name) {
      // Search in both first_name and last_name using OR condition
      // ilike is case-insensitive LIKE in PostgreSQL
      query = query.or(`first_name.ilike.%${name}%,last_name.ilike.%${name}%`);
    }

    // Apply pagination and ordering
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

app.get("/users/:userId", verifyToken, async (req, res) => {
  const { userId } = req.params;

  const { data, error } = await supabase
    .from("users")
    .select(
      "id, first_name, last_name, email, avatar_url, primary_gym, gender, age, weight, belt, stripes, height, style_preference, competition_experience, bjj_start_year, city, location, dob",
    )
    .eq("id", userId)
    .single();

  if (error) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json(data);
});
app.get("/find-match", verifyToken, async (req, res, next) => {
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

app.post("/roll-request", verifyToken, async (req, res) => {
  try {
    const { data: existingRequest, error: checkError } = await supabase
      .from("roll_requests")
      .select("*")
      .eq("sender_id", req.user.uid)
      .eq("receiver_id", req.body.receiver_id)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      throw checkError;
    }

    let data;
    if (existingRequest) {
      if (
        existingRequest.status === "declined" ||
        existingRequest.status === "cancelled"
      ) {
        const { data: updatedRequest, error: updateError } = await supabase
          .from("roll_requests")
          .update({
            status: "pending",
            created_at: new Date().toISOString(),
            responded_at: null,
          })
          .eq("id", existingRequest.id)
          .select()
          .single();

        if (updateError) throw updateError;
        data = updatedRequest;
      } else {
        return res.status(400).json({
          error: `Cannot create new request. Existing request status: ${existingRequest.status}`,
          existingRequest,
        });
      }
    } else {
      const { data: newRequest, error } = await supabase
        .from("roll_requests")
        .insert({
          sender_id: req.user.uid,
          receiver_id: req.body.receiver_id,
          status: "pending",
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      data = newRequest;
    }

    const { data: senderData } = await supabase
      .from("users")
      .select("first_name, last_name")
      .eq("id", req.user.uid)
      .single();

    await sendNotification(
      req.body.receiver_id,
      `${senderData.first_name} ${senderData.last_name} wants to be friends!`,
    );

    res.status(200).json({
      message: "Friend request sent successfully",
      data,
    });
  } catch (error) {
    console.error("Error sending roll request:", error);
    res.status(500).json({
      error: "Failed to send friend request",
      details: error,
    });
  }
});

app.get("/roll-requests", verifyToken, async (req, res) => {
  try {
    const { data: receivedRequests, error: receivedError } = await supabase
      .from("roll_requests")
      .select("*, sender:users!sender_id(*)")
      .eq("receiver_id", req.user.uid)
      .order("created_at", { ascending: false });

    const { data: sentRequests, error: sentError } = await supabase
      .from("roll_requests")
      .select("*, receiver:users!receiver_id(*)")
      .eq("sender_id", req.user.uid)
      .order("created_at", { ascending: false });

    if (receivedError || sentError) throw receivedError || sentError;

    res.status(200).json({
      received: receivedRequests,
      sent: sentRequests,
    });
  } catch (error) {
    console.error("Error fetching roll requests:", error);
    res.status(500).json({
      error: "Failed to fetch roll requests",
    });
  }
});

app.post("/roll-request/:requestId/respond", verifyToken, async (req, res) => {
  const { requestId } = req.params;
  const { status } = req.body;

  console.log("Request ID:", requestId);
  console.log("Status:", status);
  console.log("User ID:", req.user.uid);

  try {
    const { data: request, error: fetchError } = await supabase
      .from("roll_requests")
      .select(
        `*,
        sender:users!sender_id(*),
        receiver:users!receiver_id(*)`,
      )
      .eq("id", requestId)
      .single();

    if (fetchError) {
      console.log("Fetch error:", fetchError);
      return res.status(404).json({
        error: "Roll request not found",
        details: fetchError,
      });
    }

    if (status === "cancelled") {
      if (request.sender_id !== req.user.uid) {
        return res.status(403).json({
          error: "Only the sender can cancel a request",
        });
      }
    } else {
      if (request.receiver_id !== req.user.uid) {
        return res.status(403).json({
          error: "Only the receiver can accept/decline a request",
        });
      }
    }

    console.log("Attempting to update request status...");
    const { data, error } = await supabase
      .from("roll_requests")
      .update({
        status,
        responded_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .select(
        `*,
        sender:users!sender_id(*),
        receiver:users!receiver_id(*)`,
      )
      .single();

    if (error) {
      console.error("Update error:", error);
      return res.status(500).json({
        error: "Failed to update roll request status",
        details: error,
      });
    }

    if (status === "declined") {
      try {
        await sendNotification(
          request.sender.id,
          `${request.receiver.first_name} has declined your roll request`,
        );
      } catch (notificationError) {
        console.warn("Notification error:", notificationError);
      }
    } else if (status === "cancelled") {
      try {
        await sendNotification(
          request.receiver.id,
          `${request.sender.first_name} has cancelled their roll request`,
        );
      } catch (notificationError) {
        console.warn("Notification error:", notificationError);
      }
    }

    res.status(200).json({
      message: `Roll request ${status}`,
      data,
    });
  } catch (error) {
    console.error("Error in roll request response:", error);
    res.status(500).json({
      error: `Failed to respond to roll request: ${error.message}`,
      details: error,
    });
  }
});

app.post(
  "/chat-messages",
  verifyToken,
  chatImageUpload.single("image"),
  async (req, res) => {
    try {
      const rollRequestId = parseInt(req.body.chatId, 10);
      const message = req.body.message || "";
      const imageFile = req.file;

      if (isNaN(rollRequestId)) {
        return res.status(400).json({ error: "Invalid chat ID" });
      }

      console.log("Received message:", {
        rollRequestId,
        messageLength: message.length,
        hasImage: !!imageFile,
      });

      let { data: chatData, error: chatError } = await supabase
        .from("chats")
        .select("id")
        .eq("roll_request_id", rollRequestId)
        .single();

      if (chatError) {
        if (chatError.code === "PGRST116") {
          const { data: newChat, error: createError } = await supabase
            .from("chats")
            .insert({
              roll_request_id: rollRequestId,
              created_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (createError) throw createError;
          chatData = newChat;
        } else {
          throw chatError;
        }
      }

      let imageUrl = null;

      if (imageFile) {
        const fileExt = imageFile.originalname.split(".").pop();
        const fileName = `${req.user.uid}-${Date.now()}.${fileExt}`;
        const filePath = `chat-images/${fileName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("chat-attachments")
          .upload(filePath, imageFile.buffer, {
            contentType: imageFile.mimetype,
            upsert: false,
          });

        if (uploadError) {
          console.error("Error uploading image:", uploadError);
          return res.status(500).json({ error: "Failed to upload image" });
        }

        const { data: urlData } = supabase.storage
          .from("chat-attachments")
          .getPublicUrl(filePath);

        imageUrl = urlData.publicUrl;
        console.log("Image uploaded:", imageUrl);
      }

      const { data, error } = await supabase
        .from("chat_messages")
        .insert({
          chat_id: chatData.id,
          sender_id: req.user.uid,
          message: message,
          image_url: imageUrl,
          created_at: new Date().toISOString(),
        })
        .select(
          `*,
          sender:users!sender_id(id, first_name, last_name, avatar_url)`,
        )
        .single();

      if (error) throw error;

      await supabase
        .from("chats")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", chatData.id);

      res.status(200).json(data);
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({
        error: "Failed to send message",
        details: error.message,
      });
    }
  },
);

app.get("/chat-messages/:rollRequestId", verifyToken, async (req, res) => {
  const { rollRequestId } = req.params;
  console.log("Fetching messages for roll request:", rollRequestId);

  try {
    let { data: chatData, error: chatError } = await supabase
      .from("chats")
      .select("id")
      .eq("roll_request_id", rollRequestId)
      .single();

    if (chatError) {
      if (chatError.code === "PGRST116") {
        const { data: newChat, error: createError } = await supabase
          .from("chats")
          .insert({
            roll_request_id: rollRequestId,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (createError) throw createError;
        chatData = newChat;
      } else {
        throw chatError;
      }
    }

    console.log("Found/Created chat:", chatData);

    const { data: messages, error: messagesError } = await supabase
      .from("chat_messages")
      .select(
        `*,
        sender:users!sender_id(id, first_name, last_name, avatar_url)`,
      )
      .eq("chat_id", chatData.id)
      .order("created_at", { ascending: true });

    if (messagesError) throw messagesError;

    res.status(200).json({
      chat: chatData,
      messages: messages || [],
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({
      error: "Failed to fetch messages",
      details: error,
    });
  }
});

app.get("/user-profile", verifyToken, async (req, res, next) => {
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

app.post("/update-profile", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const updateData = req.body;
    console.log("Updating profile for user:", userId);
    console.log("Update data:", updateData);

    // Build the update object dynamically
    const updates = {};

    // Only include fields that are provided
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

    // ADD THIS LINE:
    if (updateData.avatar_url !== undefined)
      updates.avatar_url = updateData.avatar_url;

    // Only update location if it's provided
    if (updateData.location && updateData.location.lng !== undefined) {
      updates.location = `POINT(${updateData.location.lng} ${updateData.location.lat})`;
      if (updateData.location.city) updates.city = updateData.location.city;
    }

    // Update the user in the database
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

app.post("/logout", verifyToken, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .update({
        is_online: false,
        last_online: new Date().toISOString(),
        looking_for_roll: false,
        available_now: false,
      })
      .eq("id", req.user.uid)
      .select();

    if (error) throw error;
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
});

app.post("/deleteUser", verifyToken, async (req, res, next) => {
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

// Configure multer for post images
const postImageStorage = multer.memoryStorage();
const postImageUpload = multer({
  storage: postImageStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"));
    }
  },
});

// Configure multer for post videos
const postVideoStorage = multer.memoryStorage();
const postVideoUpload = multer({
  storage: postVideoStorage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for videos
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|mov|avi|webm/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only video files are allowed!"));
    }
  },
});

// ============================================
// 1. GET POSTS (Feed)
// ============================================
app.get("/posts", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 30;
    const offset = (page - 1) * limit;

    console.log(`Fetching posts - page: ${page}, limit: ${limit}`);

    // Use the helper function to get posts with all details
    const { data, error } = await supabase.rpc("get_posts_with_details", {
      p_limit: limit,
      p_offset: offset,
      p_current_user_id: currentUserId,
    });

    if (error) {
      console.error("Error fetching posts:", error);
      return res.status(500).json({
        error: "Failed to fetch posts",
        message: error.message,
      });
    }

    console.log(`Fetched ${data.length} posts`);
    res.json(data);
  } catch (error) {
    console.error("Error in /posts endpoint:", error);
    res.status(500).json({
      error: "Failed to fetch posts",
      message: error.message,
    });
  }
});

// ============================================
// 2. CREATE POST (Text Only)
// ============================================
app.post("/posts", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Post content is required" });
    }

    console.log("Creating text post for user:", currentUserId);

    const { data, error } = await supabase
      .from("posts")
      .insert({
        user_id: currentUserId,
        content: content.trim(),
        media_type: "none",
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating post:", error);
      return res.status(500).json({
        error: "Failed to create post",
        message: error.message,
      });
    }

    // Fetch the complete post with user details
    const { data: completePost, error: fetchError } = await supabase.rpc(
      "get_posts_with_details",
      {
        p_limit: 1,
        p_offset: 0,
        p_current_user_id: currentUserId,
      },
    );

    if (fetchError) {
      console.error("Error fetching complete post:", fetchError);
      return res.json(data); // Return basic post data
    }

    res.status(201).json(completePost[0] || data);
  } catch (error) {
    console.error("Error in /posts POST endpoint:", error);
    res.status(500).json({
      error: "Failed to create post",
      message: error.message,
    });
  }
});

// ============================================
// 3. CREATE POST WITH IMAGE
// ============================================
app.post(
  "/posts/image",
  verifyToken,
  postImageUpload.single("image"),
  async (req, res) => {
    try {
      const currentUserId = req.user.uid;
      const { content } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Post content is required" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Image file is required" });
      }

      console.log("Creating image post for user:", currentUserId);

      // Upload image to Supabase Storage
      const fileExt = path.extname(req.file.originalname);
      const fileName = `${currentUserId}_${Date.now()}${fileExt}`;
      const filePath = `${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("post-images")
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });

      if (uploadError) {
        console.error("Error uploading image:", uploadError);
        return res.status(500).json({
          error: "Failed to upload image",
          message: uploadError.message,
        });
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("post-images")
        .getPublicUrl(filePath);

      const imageUrl = urlData.publicUrl;

      // Create post with image
      const { data, error } = await supabase
        .from("posts")
        .insert({
          user_id: currentUserId,
          content: content.trim(),
          media_type: "image",
          media_url: imageUrl,
        })
        .select()
        .single();

      if (error) {
        console.error("Error creating post:", error);
        return res.status(500).json({
          error: "Failed to create post",
          message: error.message,
        });
      }

      // Fetch complete post with user details
      const { data: completePost } = await supabase.rpc(
        "get_posts_with_details",
        {
          p_limit: 1,
          p_offset: 0,
          p_current_user_id: currentUserId,
        },
      );

      res.status(201).json(completePost[0] || data);
    } catch (error) {
      console.error("Error in /posts/image endpoint:", error);
      res.status(500).json({
        error: "Failed to create post with image",
        message: error.message,
      });
    }
  },
);

// ============================================
// 4. CREATE POST WITH VIDEO
// ============================================
app.post(
  "/posts/video",
  verifyToken,
  postVideoUpload.single("video"),
  async (req, res) => {
    try {
      const currentUserId = req.user.uid;
      const { content } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Post content is required" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Video file is required" });
      }

      console.log("Creating video post for user:", currentUserId);

      // Upload video to Supabase Storage
      const fileExt = path.extname(req.file.originalname);
      const fileName = `${currentUserId}_${Date.now()}${fileExt}`;
      const filePath = `${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("post-videos")
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });

      if (uploadError) {
        console.error("Error uploading video:", uploadError);
        return res.status(500).json({
          error: "Failed to upload video",
          message: uploadError.message,
        });
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("post-videos")
        .getPublicUrl(filePath);

      const videoUrl = urlData.publicUrl;

      // Create post with video
      const { data, error } = await supabase
        .from("posts")
        .insert({
          user_id: currentUserId,
          content: content.trim(),
          media_type: "video",
          media_url: videoUrl,
          video_thumbnail_url: null, // Could generate thumbnail here
        })
        .select()
        .single();

      if (error) {
        console.error("Error creating post:", error);
        return res.status(500).json({
          error: "Failed to create post",
          message: error.message,
        });
      }

      // Fetch complete post with user details
      const { data: completePost } = await supabase.rpc(
        "get_posts_with_details",
        {
          p_limit: 1,
          p_offset: 0,
          p_current_user_id: currentUserId,
        },
      );

      res.status(201).json(completePost[0] || data);
    } catch (error) {
      console.error("Error in /posts/video endpoint:", error);
      res.status(500).json({
        error: "Failed to create post with video",
        message: error.message,
      });
    }
  },
);

// ============================================
// 5. LIKE POST
// ============================================
app.post("/posts/:postId/like", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { postId } = req.params;

    console.log(`User ${currentUserId} liking post ${postId}`);

    // Check if already liked
    const { data: existingLike } = await supabase
      .from("post_likes")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", currentUserId)
      .single();

    if (existingLike) {
      return res.status(400).json({ error: "Post already liked" });
    }

    // Create like
    const { data, error } = await supabase
      .from("post_likes")
      .insert({
        post_id: postId,
        user_id: currentUserId,
      })
      .select()
      .single();

    if (error) {
      console.error("Error liking post:", error);
      return res.status(500).json({
        error: "Failed to like post",
        message: error.message,
      });
    }

    // Get updated like count
    const { count } = await supabase
      .from("post_likes")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId);

    res.json({ success: true, likes_count: count });
  } catch (error) {
    console.error("Error in /posts/:postId/like endpoint:", error);
    res.status(500).json({
      error: "Failed to like post",
      message: error.message,
    });
  }
});

// ============================================
// 6. UNLIKE POST
// ============================================
app.delete("/posts/:postId/like", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { postId } = req.params;

    console.log(`User ${currentUserId} unliking post ${postId}`);

    const { error } = await supabase
      .from("post_likes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", currentUserId);

    if (error) {
      console.error("Error unliking post:", error);
      return res.status(500).json({
        error: "Failed to unlike post",
        message: error.message,
      });
    }

    // Get updated like count
    const { count } = await supabase
      .from("post_likes")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId);

    res.json({ success: true, likes_count: count });
  } catch (error) {
    console.error("Error in /posts/:postId/like DELETE endpoint:", error);
    res.status(500).json({
      error: "Failed to unlike post",
      message: error.message,
    });
  }
});

// ============================================
// 7. GET COMMENTS FOR POST
// ============================================
app.get("/posts/:postId/comments", verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = (page - 1) * limit;

    console.log(`Fetching comments for post ${postId}`);

    const { data, error } = await supabase.rpc("get_post_comments", {
      p_post_id: postId,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      console.error("Error fetching comments:", error);
      return res.status(500).json({
        error: "Failed to fetch comments",
        message: error.message,
      });
    }

    res.json(data);
  } catch (error) {
    console.error("Error in /posts/:postId/comments endpoint:", error);
    res.status(500).json({
      error: "Failed to fetch comments",
      message: error.message,
    });
  }
});

// ============================================
// 8. ADD COMMENT TO POST
// ============================================
app.post("/posts/:postId/comments", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { postId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Comment content is required" });
    }

    console.log(`User ${currentUserId} commenting on post ${postId}`);

    const { data, error } = await supabase
      .from("post_comments")
      .insert({
        post_id: postId,
        user_id: currentUserId,
        content: content.trim(),
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating comment:", error);
      return res.status(500).json({
        error: "Failed to create comment",
        message: error.message,
      });
    }

    // Fetch complete comment with user details
    const { data: completeComment } = await supabase.rpc("get_post_comments", {
      p_post_id: postId,
      p_limit: 1,
      p_offset: 0,
    });

    res.status(201).json(completeComment[0] || data);
  } catch (error) {
    console.error("Error in /posts/:postId/comments POST endpoint:", error);
    res.status(500).json({
      error: "Failed to create comment",
      message: error.message,
    });
  }
});

// ============================================
// 9. DELETE POST
// ============================================
app.delete("/posts/:postId", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { postId } = req.params;

    console.log(`User ${currentUserId} deleting post ${postId}`);

    // Soft delete (set is_deleted = true)
    const { data, error } = await supabase
      .from("posts")
      .update({ is_deleted: true })
      .eq("id", postId)
      .eq("user_id", currentUserId)
      .select()
      .single();

    if (error) {
      console.error("Error deleting post:", error);
      return res.status(500).json({
        error: "Failed to delete post",
        message: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({ error: "Post not found or unauthorized" });
    }

    res.json({ success: true, message: "Post deleted successfully" });
  } catch (error) {
    console.error("Error in /posts/:postId DELETE endpoint:", error);
    res.status(500).json({
      error: "Failed to delete post",
      message: error.message,
    });
  }
});

// BJJ News RSS Feed Integration
// Add this to your rollmate-server

const Parser = require("rss-parser");
const parser = new Parser();

// BJJ News Sources
const RSS_FEEDS = [
  {
    name: "Grappling Insider",
    url: "https://grapplinginsider.com/feed/",
    avatar: "https://grapplinginsider.com/favicon.ico",
  },
  {
    name: "BJJ Heroes",
    url: "https://www.bjjheroes.com/feed",
    avatar: "https://www.bjjheroes.com/favicon.ico",
  },
];

// Create a system user for news posts (run once)
async function createNewsUser() {
  const { data, error } = await supabase
    .from("users")
    .upsert({
      id: "bjj-news-bot",
      first_name: "BJJ",
      last_name: "News",
      email: "news@rollmate.app",
      avatar_url: "https://i.pravatar.cc/150?img=50",
      gender: "other",
      age: 0,
      weight: 0,
      belt: "black",
      stripes: 4,
      height: 0,
      primary_gym: "RollMate",
      city: "Global",
      location: "POINT(0 0)",
    })
    .select()
    .single();

  if (error) console.error("Error creating news user:", error);
  return data;
}

// Fetch and parse RSS feed
async function fetchRSSFeed(feedUrl) {
  try {
    const feed = await parser.parseURL(feedUrl);
    return feed.items;
  } catch (error) {
    console.error(`Error fetching RSS feed ${feedUrl}:`, error);
    return [];
  }
}

// Check if article already posted
async function isArticlePosted(articleUrl) {
  const { data, error } = await supabase
    .from("posts")
    .select("id")
    .eq("user_id", "bjj-news-bot")
    .ilike("content", `%${articleUrl}%`)
    .single();

  return !!data;
}

// Create post from RSS article
async function createNewsPost(article, sourceName) {
  try {
    // Check if already posted
    if (await isArticlePosted(article.link)) {
      console.log(`Article already posted: ${article.title}`);
      return null;
    }

    // Extract image from content or use default
    let imageUrl = null;
    if (article.enclosure?.url) {
      imageUrl = article.enclosure.url;
    } else if (article.content) {
      const imgMatch = article.content.match(/<img[^>]+src="([^">]+)"/);
      if (imgMatch) imageUrl = imgMatch[1];
    }

    // Create post content
    const content = `${article.title}\n\n${
      article.contentSnippet || ""
    }\n\nRead more: ${article.link}\n\n#BJJNews #${sourceName.replace(
      /\s/g,
      "",
    )}`;

    const { data, error } = await supabase
      .from("posts")
      .insert({
        user_id: "bjj-news-bot",
        content: content.substring(0, 1000), // Limit length
        media_type: imageUrl ? "image" : "none",
        media_url: imageUrl,
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`Created news post: ${article.title}`);
    return data;
  } catch (error) {
    console.error("Error creating news post:", error);
    return null;
  }
}
app.post("/posts/youtube", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { content, videoUrl } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Post content is required" });
    }

    if (!videoUrl) {
      return res.status(400).json({ error: "YouTube video URL is required" });
    }

    // Validate YouTube URL
    const youtubeUrlPattern =
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    if (!youtubeUrlPattern.test(videoUrl)) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    console.log("Creating YouTube video post for user:", currentUserId);

    // Create post with YouTube video URL
    const { data, error } = await supabase
      .from("posts")
      .insert({
        user_id: currentUserId,
        content: content.trim(),
        media_type: "video",
        media_url: videoUrl,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating post:", error);
      return res.status(500).json({
        error: "Failed to create post",
        message: error.message,
      });
    }

    // Fetch complete post with user details
    const { data: completePost } = await supabase.rpc(
      "get_posts_with_details",
      {
        p_limit: 1,
        p_offset: 0,
        p_current_user_id: currentUserId,
      },
    );

    res.status(201).json(completePost[0] || data);
  } catch (error) {
    console.error("Error in /posts/youtube endpoint:", error);
    res.status(500).json({
      error: "Failed to create post with YouTube video",
      message: error.message,
    });
  }
});

// Main function to fetch and post news
async function fetchAndPostBJJNews() {
  console.log("Fetching BJJ news...");

  // Ensure news user exists
  await createNewsUser();

  let totalPosts = 0;

  for (const feed of RSS_FEEDS) {
    console.log(`Fetching from ${feed.name}...`);
    const articles = await fetchRSSFeed(feed.url);

    // Post only the 3 most recent articles per source
    const recentArticles = articles.slice(0, 3);

    for (const article of recentArticles) {
      const post = await createNewsPost(article, feed.name);
      if (post) totalPosts++;
    }
  }

  console.log(`Posted ${totalPosts} new BJJ news articles`);
  return totalPosts;
}

// Manual endpoint to trigger news fetch
app.get("/fetch-bjj-news", async (req, res) => {
  try {
    const count = await fetchAndPostBJJNews();
    res.json({
      success: true,
      message: `Fetched and posted ${count} news articles`,
    });
  } catch (error) {
    console.error("Error fetching BJJ news:", error);
    res.status(500).json({
      error: "Failed to fetch BJJ news",
      message: error.message,
    });
  }
});

// Schedule news fetch every 6 hours
const cron = require("node-cron");

// Run every 6 hours
cron.schedule("0 */6 * * *", async () => {
  console.log("Running scheduled BJJ news fetch...");
  await fetchAndPostBJJNews();
});

// Run once on server start
setTimeout(() => {
  fetchAndPostBJJNews();
}, 5000); // Wait 5 seconds after server starts

module.exports = { fetchAndPostBJJNews };

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
