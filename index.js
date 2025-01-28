const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
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

// Notification sending function
const sendNotification = async (userId, senderName) => {
  const userToken = await getUserFCMToken(userId);

  if (!userToken) {
    console.log("No FCM token found for user:", userId);
    return;
  }

  try {
    await admin.messaging().send({
      token: userToken,
      notification: {
        title: "New Roll Request",
        body: `${senderName} wants to roll with you!`,
      },
      data: {
        type: "roll_request",
      },
    });
    console.log("Notification sent successfully to:", userId);
  } catch (error) {
    console.error("Error sending notification:", error);
  }
};

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

    res.status(200).json({ exists: !!data });
  } catch (error) {
    next(error);
  }
});

// Registration endpoint
app.post("/register", verifyToken, async (req, res, next) => {
  console.log("Received request body:", req.body);
  try {
    // Convert location to PostGIS point format
    const locationPoint = `POINT(${req.body.location.lng} ${req.body.location.lat})`;

    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          id: req.user.uid,
          first_name: req.body.first_name,
          last_name: req.body.last_name,
          email: req.user.email,
          avatar_url: req.user.picture,
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
          is_online: true,
          last_online: new Date().toISOString(),
          looking_for_roll: req.body.looking_for_roll,
          available_now: req.body.available_now,
          location: locationPoint,
          city: req.body.location.city,
          fcm_token: req.body.fcm_token,
        },
      ])
      .select();

    console.log("Supabase response data:", data);

    if (error) throw error;

    // After creating user, insert their availability
    if (req.body.availability) {
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

// Get nearby users
app.get("/nearby", verifyToken, async (req, res, next) => {
  try {
    const { lat, lng, radius = 10000 } = req.query;

    const { data, error } = await supabase.rpc("find_nearby_users", {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      radius_meters: parseInt(radius),
    });

    if (error) throw error;

    // Filter out the requesting user
    const nearbyUsers = data.filter((user) => user.id !== req.user.uid);
    res.status(200).json(nearbyUsers);
  } catch (error) {
    next(error);
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
