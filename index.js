const fs = require("fs");
const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
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

app.post("/profile-pics", upload.single("file"), async (req, res) => {
  try {
    console.log("File upload request received");
    console.log("req.file:", req.file);
    console.log("req.body:", req.body);

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded",
        details: "Please select a file to upload",
      });
    }

    // Read the uploaded file using the path provided by multer
    const fileBuffer = fs.readFileSync(req.file.path);
    console.log("File read successfully, size:", fileBuffer.length);

    // Generate a unique filename
    const fileExtension = req.file.originalname.split(".").pop();
    const uniqueFileName = `profile-pic-${Date.now()}-${Math.random()
      .toString(36)
      .substring(7)}.${fileExtension}`;

    // Upload to Supabase storage
    const { data, error } = await supabase.storage
      .from("profile-pics")
      .upload(uniqueFileName, fileBuffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    // Clean up the temporary file
    fs.unlinkSync(req.file.path);

    if (error) {
      console.error("Supabase storage error:", error);
      return res.status(500).json({
        error: "Failed to upload to storage",
        details: error.message,
      });
    }

    console.log("File uploaded successfully:", data);

    // Get the public URL for the uploaded file
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

    // Clean up temp file if it exists
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
      // PGRST116 is the "not found" error code
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
    // Check if location exists in request body
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

    let avatarUrl = req.user.picture; // Default to Firebase user picture

    // Handle profile picture URL if provided in body
    if (req.body.profilePhoto && req.body.profilePhoto !== req.user.picture) {
      console.log("Using uploaded profile picture URL:", req.body.profilePhoto);
      avatarUrl = req.body.profilePhoto;
    }

    // Convert location to PostGIS point format
    const locationPoint = `POINT(${req.body.location.lng} ${req.body.location.lat})`;

    // Calculate default weight range
    const weightRangeMin = req.body.weight - 20;
    const weightRangeMax = req.body.weight + 20;

    // Prepare user data
    const userData = {
      id: req.user.uid,
      first_name: req.body.first_name,
      last_name: req.body.last_name,
      email: req.user.email,
      avatar_url: avatarUrl, // Use uploaded image URL or fallback
      gender: req.body.gender,
      age: req.body.age || 0,
      weight: req.body.weight,
      belt: req.body.belt,
      stripes: parseInt(req.body.stripes) || 0,
      height: req.body.height,
      dob: req.body.dob,

      // Default values for fields not collected in onboarding
      primary_gym: "Not specified",
      style_preference: "both",
      years_experience: 0,
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

    // Insert user data
    const { data, error } = await supabase
      .from("users")
      .insert([userData])
      .select();

    console.log("Supabase response data:", data);

    if (error) {
      console.error("Supabase error:", error);
      throw error;
    }

    // Insert default availability
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
      // Don't throw here, just log it
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

// Get all users for feed
app.get("/users", verifyToken, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("users").select();
    return res.json(data);
  } catch (error) {
    res.json(error);
  }
});

app.get("/find-match", verifyToken, async (req, res, next) => {
  try {
    const { data, error } = await supabase.rpc("find_potential_matches", {
      p_requesting_user_id: req.user.uid,
      p_max_distance: 10000000.0, // 10,000 km
    });
    console.log(data);

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(200).json({
        noMatches: true,
        message: "No matches available",
      });
    }

    // If we found a match, return the full match data
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

// In your server code where you handle roll requests
app.post("/roll-request", verifyToken, async (req, res) => {
  try {
    // First check if a request already exists
    const { data: existingRequest, error: checkError } = await supabase
      .from("roll_requests")
      .select("*")
      .eq("sender_id", req.user.uid)
      .eq("receiver_id", req.body.receiver_id)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116 means no rows found, which is fine
      throw checkError;
    }

    let data;
    if (existingRequest) {
      // Allow re-requesting if status is either declined or cancelled
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
        // If request exists and is not declined or cancelled, send appropriate message
        return res.status(400).json({
          error: `Cannot create new request. Existing request status: ${existingRequest.status}`,
          existingRequest,
        });
      }
    } else {
      // If no request exists, create new one
      const { data: newRequest, error } = await supabase.rpc(
        "create_roll_request",
        {
          p_sender_id: req.user.uid,
          p_receiver_id: req.body.receiver_id,
        }
      );

      if (error) throw error;
      data = newRequest;
    }

    // Get sender's name for notification
    const { data: senderData } = await supabase
      .from("users")
      .select("first_name, last_name")
      .eq("id", req.user.uid)
      .single();

    // Send notification to receiver
    await sendNotification(
      req.body.receiver_id,
      `${senderData.first_name} ${senderData.last_name} wants to roll with you!`
    );

    res.status(200).json({
      message: "Roll request sent successfully",
      data,
    });
  } catch (error) {
    console.error("Error sending roll request:", error);
    res.status(500).json({
      error: "Failed to send roll request",
      details: error,
    });
  }
});

// Get user's roll requests (both sent and received)
app.get("/roll-requests", verifyToken, async (req, res) => {
  try {
    // Get received requests
    const { data: receivedRequests, error: receivedError } = await supabase
      .from("roll_requests")
      .select("*, sender:users!sender_id(*)")
      .eq("receiver_id", req.user.uid)
      .order("created_at", { ascending: false });

    // Get sent requests
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

// Respond to a roll request (accept/decline)
app.post("/roll-request/:requestId/respond", verifyToken, async (req, res) => {
  const { requestId } = req.params;
  const { status } = req.body;
  console.log("Request ID:", requestId);
  console.log("Status:", status);
  console.log("User ID:", req.user.uid);

  try {
    // First just get the request to see if it exists
    const { data: request, error: fetchError } = await supabase
      .from("roll_requests")
      .select(
        `
        *,
        sender:users!sender_id(*),
        receiver:users!receiver_id(*)
      `
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

    // Check authorization based on the action
    if (status === "cancelled") {
      // Only sender can cancel
      if (request.sender_id !== req.user.uid) {
        return res.status(403).json({
          error: "Only the sender can cancel a request",
        });
      }
    } else {
      // For accept/decline, only receiver can respond
      if (request.receiver_id !== req.user.uid) {
        return res.status(403).json({
          error: "Only the receiver can accept/decline a request",
        });
      }
    }

    // Update request status
    console.log("Attempting to update request status...");
    const { data, error } = await supabase
      .from("roll_requests")
      .update({
        status,
        responded_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .select(
        `
        *,
        sender:users!sender_id(*),
        receiver:users!receiver_id(*)
      `
      )
      .single();

    if (error) {
      console.error("Update error:", error);
      return res.status(500).json({
        error: "Failed to update roll request status",
        details: error,
      });
    }

    // Handle notifications
    if (status === "declined") {
      try {
        await sendNotification(
          request.sender.id,
          `${request.receiver.first_name} has declined your roll request`
        );
      } catch (notificationError) {
        console.warn("Notification error:", notificationError);
      }
    } else if (status === "cancelled") {
      try {
        await sendNotification(
          request.receiver.id,
          `${request.sender.first_name} has cancelled their roll request`
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
// POST endpoint to send a message
app.post("/chat-messages", verifyToken, async (req, res) => {
  const { chatId: rollRequestId, message } = req.body;

  try {
    // First ensure chat exists
    let { data: chatData, error: chatError } = await supabase
      .from("chats")
      .select("id")
      .eq("roll_request_id", rollRequestId)
      .single();

    if (chatError) {
      if (chatError.code === "PGRST116") {
        // Chat doesn't exist, create it
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

    // Insert the message
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        chat_id: chatData.id,
        sender_id: req.user.uid,
        message: message,
        created_at: new Date().toISOString(),
      })
      .select(
        `
        *,
        sender:users!sender_id(
          id,
          first_name,
          last_name,
          avatar_url
        )
      `
      )
      .single();

    if (error) throw error;

    // Update last_message_at timestamp
    await supabase
      .from("chats")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", chatData.id);

    res.status(200).json(data);
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({
      error: "Failed to send message",
      details: error,
    });
  }
});
// GET endpoint to fetch chat messages
app.get("/chat-messages/:rollRequestId", verifyToken, async (req, res) => {
  const { rollRequestId } = req.params;
  console.log("Fetching messages for roll request:", rollRequestId);

  try {
    // Get or create chat
    let { data: chatData, error: chatError } = await supabase
      .from("chats")
      .select("id")
      .eq("roll_request_id", rollRequestId)
      .single();

    if (chatError) {
      if (chatError.code === "PGRST116") {
        // Create new chat
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

    // Get messages
    const { data: messages, error: messagesError } = await supabase
      .from("chat_messages")
      .select(
        `
        *,
        sender:users!sender_id(
          id,
          first_name,
          last_name,
          avatar_url
        )
      `
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

// Get user profile
app.get("/user-profile", verifyToken, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select(
        `
        *,
        availability (
          day,
          morning,
          afternoon,
          evening,
          night
        )
      `
      )
      .eq("id", req.user.uid)
      .single();

    if (error) throw error;

    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

// Update user profile
app.post("/update-profile", verifyToken, async (req, res, next) => {
  console.log("Updating profile for user:", req.user.uid);
  console.log("Update data:", req.body);

  try {
    // Convert location to PostGIS point format
    const locationPoint = `POINT(${req.body.location.lng} ${req.body.location.lat})`;

    // Update user data
    const { data, error } = await supabase
      .from("users")
      .update({
        first_name: req.body.first_name,
        last_name: req.body.last_name,
        avatar_url: req.body.avatar_url,
        primary_gym: req.body.primary_gym,
        gender: req.body.gender,
        age: req.body.age,
        weight: req.body.weight,
        belt: req.body.belt,
        stripes: req.body.stripes,
        style_preference: req.body.style_preference,
        years_experience: req.body.years_experience,
        competition_experience: req.body.competition_experience,
        intensity_level: req.body.intensity_level,
        weight_range_min: req.body.weight_range_min,
        weight_range_max: req.body.weight_range_max,
        looking_for_roll: req.body.looking_for_roll,
        available_now: req.body.available_now,
        location: locationPoint,
        city: req.body.location.city,
      })
      .eq("id", req.user.uid)
      .select();

    if (error) throw error;

    // Update availability
    if (req.body.availability) {
      // First, delete existing availability
      const { error: deleteError } = await supabase
        .from("availability")
        .delete()
        .eq("user_id", req.user.uid);

      if (deleteError) throw deleteError;

      // Then insert new availability
      const { error: availError } = await supabase.from("availability").insert(
        req.body.availability.map((avail) => ({
          user_id: req.user.uid,
          ...avail,
        }))
      );

      if (availError) throw availError;
    }

    res.status(200).json(data[0]);
  } catch (error) {
    next(error);
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
// Helper function to check availability overlap
function hasAvailabilityOverlap(userAvail1, userAvail2) {
  const days = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  const timeSlots = ["morning", "afternoon", "evening", "night"];

  return days.some((day) => {
    if (!userAvail1[day].available || !userAvail2[day].available) return false;

    return timeSlots.some(
      (time) =>
        userAvail1[day].timeRanges[time] && userAvail2[day].timeRanges[time]
    );
  });
}

// Error handling middleware
app.use(errorHandler);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
