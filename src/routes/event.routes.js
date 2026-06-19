const express = require("express");
const router = express.Router();
const path = require("path");
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { postImageUpload } = require("../middleware/upload");
const {
  sendNotification,
  sendNotificationToMany,
} = require("../services/notification");

const VALID_EVENT_TYPES = [
  "open_mat",
  "seminar",
  "meetup",
  "tournament",
  "other",
];

// Helper: get friend IDs for a user
async function getFriendIds(userId) {
  const { data: friendships } = await supabase
    .from("roll_requests")
    .select("sender_id, receiver_id")
    .eq("status", "accepted")
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);

  return (friendships || []).map((f) =>
    f.sender_id === userId ? f.receiver_id : f.sender_id,
  );
}

// Helper: filter out events from private non-friend users
async function filterPrivateEvents(events, currentUserId) {
  if (!events || events.length === 0) return events;

  const creatorIds = [...new Set(events.map((e) => e.creator_id))];
  const { data: privateUsers } = await supabase
    .from("users")
    .select("id")
    .in("id", creatorIds)
    .eq("is_private", true);

  if (!privateUsers || privateUsers.length === 0) return events;

  const privateIds = new Set(privateUsers.map((u) => u.id));
  const friendIds = new Set(await getFriendIds(currentUserId));

  return events.filter(
    (e) =>
      e.creator_id === currentUserId ||
      friendIds.has(e.creator_id) ||
      !privateIds.has(e.creator_id),
  );
}

// Helper: enrich events with creator info, RSVP count, current user RSVP status, and avatars
async function enrichEvents(events, currentUserId) {
  if (!events || events.length === 0) return [];

  const eventIds = events.map((e) => e.id);
  const creatorIds = [...new Set(events.map((e) => e.creator_id))];

  // Fetch creator info
  const { data: creators } = await supabase
    .from("users")
    .select("id, first_name, last_name, avatar_url")
    .in("id", creatorIds);

  const creatorMap = {};
  (creators || []).forEach((u) => {
    creatorMap[u.id] = u;
  });

  // Fetch all RSVPs for these events
  const { data: rsvps } = await supabase
    .from("event_rsvps")
    .select("event_id, user_id")
    .in("event_id", eventIds);

  // Build RSVP counts and current-user flags
  const rsvpsByEvent = {};
  (rsvps || []).forEach((r) => {
    if (!rsvpsByEvent[r.event_id]) rsvpsByEvent[r.event_id] = [];
    rsvpsByEvent[r.event_id].push(r.user_id);
  });

  // Collect unique RSVP user IDs for avatar lookup (first 3 per event)
  const avatarUserIds = new Set();
  for (const eid of eventIds) {
    const users = rsvpsByEvent[eid] || [];
    users.slice(0, 3).forEach((uid) => avatarUserIds.add(uid));
  }

  let avatarMap = {};
  if (avatarUserIds.size > 0) {
    const { data: avatarUsers } = await supabase
      .from("users")
      .select("id, avatar_url")
      .in("id", [...avatarUserIds]);
    (avatarUsers || []).forEach((u) => {
      avatarMap[u.id] = u.avatar_url;
    });
  }

  return events.map((event) => {
    const creator = creatorMap[event.creator_id] || {};
    const eventRsvpUsers = rsvpsByEvent[event.id] || [];
    return {
      ...event,
      creator_first_name: creator.first_name || null,
      creator_last_name: creator.last_name || null,
      creator_avatar_url: creator.avatar_url || null,
      rsvp_count: eventRsvpUsers.length,
      is_rsvped_by_current_user: eventRsvpUsers.includes(currentUserId),
      rsvp_avatars: eventRsvpUsers
        .slice(0, 3)
        .map((uid) => avatarMap[uid] || null),
    };
  });
}

// POST /events/upload-cover — Upload event cover image
router.post(
  "/events/upload-cover",
  verifyToken,
  postImageUpload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const fileExt = path.extname(req.file.originalname || ".jpg");
      const fileName = `event-cover-${req.user.uid}-${Date.now()}${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("post-images")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("post-images")
        .getPublicUrl(fileName);

      res.json({ publicUrl: urlData.publicUrl });
    } catch (error) {
      console.error("Error uploading event cover:", error);
      res.status(500).json({ error: "Failed to upload cover image" });
    }
  },
);

// POST /events — Create an event
router.post("/events", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const {
      title,
      description,
      event_type,
      event_date,
      end_date,
      location_name,
      location_address,
      latitude,
      longitude,
      external_link,
      cover_image_url,
      recurrence,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }
    if (!event_type || !VALID_EVENT_TYPES.includes(event_type)) {
      return res.status(400).json({
        error: `event_type must be one of: ${VALID_EVENT_TYPES.join(", ")}`,
      });
    }
    if (!event_date) {
      return res.status(400).json({ error: "event_date is required" });
    }
    if (!location_name || !location_name.trim()) {
      return res.status(400).json({ error: "location_name is required" });
    }

    const VALID_RECURRENCES = ["once", "weekly", "biweekly", "monthly"];
    const eventRecurrence =
      recurrence && VALID_RECURRENCES.includes(recurrence)
        ? recurrence
        : "once";

    const { data: event, error } = await supabase
      .from("events")
      .insert({
        creator_id: userId,
        title: title.trim(),
        description: (description || "").trim(),
        event_type,
        event_date,
        end_date: end_date || null,
        location_name: location_name.trim(),
        location_address: location_address || null,
        latitude: latitude || null,
        longitude: longitude || null,
        external_link: external_link || null,
        cover_image_url: cover_image_url || null,
        recurrence: eventRecurrence,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating event:", error);
      return res
        .status(500)
        .json({ error: "Failed to create event", message: error.message });
    }

    // Notify creator's friends
    const { data: user } = await supabase
      .from("users")
      .select("first_name, last_name, avatar_url")
      .eq("id", userId)
      .single();

    const friendIds = await getFriendIds(userId);

    if (friendIds.length > 0 && user) {
      const notifications = friendIds.map((fid) => ({
        user_id: fid,
        type: "event",
        title: `${user.first_name} created an event 📅`,
        body: title.trim(),
        actor_id: userId,
        actor_name: `${user.first_name} ${user.last_name}`,
        actor_avatar: user.avatar_url,
        reference_id: event.id,
      }));
      await supabase.from("notifications").insert(notifications);

      // Send push notifications to friends (fire and forget)
      sendNotificationToMany(friendIds, title.trim(), {
        title: `${user.first_name} created an event 📅`,
        data: {
          type: "event",
          event_id: String(event.id),
          user_id: userId,
          user_name: `${user.first_name} ${user.last_name}`,
        },
      }).catch((err) =>
        console.error("Error sending event push notifications:", err),
      );
    }

    const [enriched] = await enrichEvents([event], userId);
    res.status(201).json(enriched);
  } catch (error) {
    console.error("Error in POST /events:", error);
    res
      .status(500)
      .json({ error: "Failed to create event", message: error.message });
  }
});

// GET /events/mine — Current user's events (with search and sort)
router.get("/events/mine", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = (page - 1) * limit;
    const search = req.query.search;
    const sort = req.query.sort || "date_desc";

    let query = supabase
      .from("events")
      .select("*", { count: "exact" })
      .eq("creator_id", userId)
      .eq("is_deleted", false);

    if (search) {
      query = query.or(
        `title.ilike.%${search}%,location_name.ilike.%${search}%`,
      );
    }

    const ascending = sort === "date_asc";
    query = query
      .order("event_date", { ascending })
      .range(offset, offset + limit - 1);

    const { data: events, error, count } = await query;

    if (error) {
      console.error("Error fetching user events:", error);
      return res
        .status(500)
        .json({ error: "Failed to fetch events", message: error.message });
    }

    const enriched = await enrichEvents(events || [], userId);
    res.json({ events: enriched, total: count, page, limit });
  } catch (error) {
    console.error("Error in GET /events/mine:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch events", message: error.message });
  }
});

// GET /events — Upcoming events (paginated, optional location filter)
router.get("/events", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = (page - 1) * limit;
    const latitude = parseFloat(req.query.latitude);
    const longitude = parseFloat(req.query.longitude);
    const radius = parseFloat(req.query.radius) || 50; // miles
    const search = req.query.search;

    let query = supabase
      .from("events")
      .select("*")
      .eq("is_deleted", false)
      .gte("event_date", new Date().toISOString())
      .order("event_date", { ascending: true })
      .range(offset, offset + limit - 1);

    if (search) {
      // Also match events by creator name
      const { data: matchingUsers } = await supabase
        .from("users")
        .select("id")
        .or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`);

      const userIds = (matchingUsers || []).map((u) => u.id);

      if (userIds.length > 0) {
        query = query.or(
          `title.ilike.%${search}%,location_name.ilike.%${search}%,description.ilike.%${search}%,creator_id.in.(${userIds.join(",")})`,
        );
      } else {
        query = query.or(
          `title.ilike.%${search}%,location_name.ilike.%${search}%,description.ilike.%${search}%`,
        );
      }
    }

    const { data: events, error } = await query;

    if (error) {
      console.error("Error fetching events:", error);
      return res
        .status(500)
        .json({ error: "Failed to fetch events", message: error.message });
    }

    // Filter by distance if lat/lng provided
    let filtered = events || [];
    if (!isNaN(latitude) && !isNaN(longitude)) {
      filtered = filtered.filter((e) => {
        if (e.latitude == null || e.longitude == null) return false;
        const dist = haversineDistance(
          latitude,
          longitude,
          e.latitude,
          e.longitude,
        );
        return dist <= radius;
      });
    }

    // Privacy filter
    filtered = await filterPrivateEvents(filtered, currentUserId);

    const enriched = await enrichEvents(filtered, currentUserId);
    res.json(enriched);
  } catch (error) {
    console.error("Error in GET /events:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch events", message: error.message });
  }
});

// GET /events/feed — Events for home feed injection (friends + own events)
router.get("/events/feed", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const now = new Date().toISOString();

    // Get friend IDs
    const friendIds = await getFriendIds(currentUserId);
    const allowedCreators = [currentUserId, ...friendIds];

    const { data: events, error } = await supabase
      .from("events")
      .select("*")
      .eq("is_deleted", false)
      .gte("event_date", now)
      .in("creator_id", allowedCreators)
      .order("event_date", { ascending: true });

    if (error) {
      console.error("Error fetching feed events:", error);
      return res
        .status(500)
        .json({ error: "Failed to fetch feed events", message: error.message });
    }

    const enriched = await enrichEvents(events || [], currentUserId);
    res.json(enriched);
  } catch (error) {
    console.error("Error in GET /events/feed:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch feed events", message: error.message });
  }
});

// GET /events/:eventId — Fetch a single event by ID
router.get("/events/:eventId", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { eventId } = req.params;

    const { data: event, error } = await supabase
      .from("events")
      .select("*")
      .eq("id", eventId)
      .eq("is_deleted", false)
      .single();

    if (error || !event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const [enriched] = await enrichEvents([event], currentUserId);
    res.json(enriched);
  } catch (error) {
    console.error("Error in GET /events/:eventId:", error);
    res.status(500).json({ error: "Failed to fetch event" });
  }
});

// GET /events/:eventId/rsvps — Users who RSVP'd
router.get("/events/:eventId/rsvps", verifyToken, async (req, res) => {
  try {
    const { data: rsvps, error } = await supabase
      .from("event_rsvps")
      .select("user_id")
      .eq("event_id", req.params.eventId);

    if (error) throw error;

    const userIds = (rsvps || []).map((r) => r.user_id);
    if (userIds.length === 0) return res.json([]);

    const { data: users } = await supabase
      .from("users")
      .select("id, first_name, last_name, avatar_url, belt")
      .in("id", userIds);

    res.json(users || []);
  } catch (error) {
    console.error("Error in GET /events/:eventId/rsvps:", error);
    res.status(500).json({ error: "Failed to fetch RSVPs" });
  }
});

// POST /events/:eventId/rsvp — Toggle RSVP
router.post("/events/:eventId/rsvp", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { eventId } = req.params;

    // Check event exists
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, creator_id, title")
      .eq("id", eventId)
      .eq("is_deleted", false)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Check if already RSVP'd
    const { data: existing } = await supabase
      .from("event_rsvps")
      .select("id")
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .single();

    if (existing) {
      // Remove RSVP
      await supabase.from("event_rsvps").delete().eq("id", existing.id);
    } else {
      // Add RSVP
      const { error: insertError } = await supabase
        .from("event_rsvps")
        .insert({ event_id: eventId, user_id: userId });

      if (insertError) {
        console.error("Error creating RSVP:", insertError);
        return res
          .status(500)
          .json({ error: "Failed to RSVP", message: insertError.message });
      }
    }

    // Get updated count
    const { count } = await supabase
      .from("event_rsvps")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId);

    res.json({ rsvped: !existing, rsvp_count: count || 0 });

    // Notify event creator on RSVP (fire and forget)
    if (!existing && event.creator_id !== userId) {
      supabase
        .from("users")
        .select("first_name, last_name, avatar_url")
        .eq("id", userId)
        .single()
        .then(({ data: user }) => {
          if (!user) return;
          // In-app notification
          supabase.from("notifications").insert({
            user_id: event.creator_id,
            type: "event_rsvp",
            title: `${user.first_name} is going to your event 🤙`,
            body: event.title,
            actor_id: userId,
            actor_name: `${user.first_name} ${user.last_name}`,
            actor_avatar: user.avatar_url,
            reference_id: eventId,
          });

          // Push notification
          sendNotification(event.creator_id, event.title, {
            title: `${user.first_name} is going to your event 🤙`,
            data: {
              type: "event",
              event_id: String(eventId),
              user_id: userId,
              user_name: `${user.first_name} ${user.last_name}`,
            },
          });
        })
        .catch((err) => console.error("Error sending RSVP notification:", err));
    }
  } catch (error) {
    console.error("Error in POST /events/:eventId/rsvp:", error);
    res
      .status(500)
      .json({ error: "Failed to toggle RSVP", message: error.message });
  }
});

// PUT /events/:eventId — Update an event (creator only)
router.put("/events/:eventId", verifyToken, async (req, res) => {
  try {
    const { eventId } = req.params;
    const updates = { ...req.body, updated_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from("events")
      .update(updates)
      .eq("id", eventId)
      .eq("creator_id", req.user.uid)
      .select()
      .single();

    if (error) throw error;
    if (!data)
      return res.status(404).json({ error: "Event not found or unauthorized" });

    res.json(data);
  } catch (error) {
    console.error("Error in PUT /events/:eventId:", error);
    res.status(500).json({ error: "Failed to update event" });
  }
});

// DELETE /events/:eventId — Soft delete (creator only)
router.delete("/events/:eventId", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { eventId } = req.params;

    const { data, error } = await supabase
      .from("events")
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq("id", eventId)
      .eq("creator_id", userId)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Event not found or unauthorized" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error in DELETE /events/:eventId:", error);
    res
      .status(500)
      .json({ error: "Failed to delete event", message: error.message });
  }
});

// GET /events/nearby — Events near a location (for Locate map)
router.get("/events/nearby", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const latitude = parseFloat(req.query.latitude);
    const longitude = parseFloat(req.query.longitude);
    const radius = parseFloat(req.query.radius) || 25;

    if (isNaN(latitude) || isNaN(longitude)) {
      return res
        .status(400)
        .json({ error: "latitude and longitude are required" });
    }

    const { data: events, error } = await supabase
      .from("events")
      .select("*")
      .eq("is_deleted", false)
      .gte("event_date", new Date().toISOString())
      .order("event_date", { ascending: true });

    if (error) {
      console.error("Error fetching nearby events:", error);
      return res.status(500).json({
        error: "Failed to fetch nearby events",
        message: error.message,
      });
    }

    let filtered = (events || []).filter((e) => {
      if (e.latitude == null || e.longitude == null) return false;
      return (
        haversineDistance(latitude, longitude, e.latitude, e.longitude) <=
        radius
      );
    });

    filtered = await filterPrivateEvents(filtered, currentUserId);
    const enriched = await enrichEvents(filtered, currentUserId);
    res.json(enriched);
  } catch (error) {
    console.error("Error in GET /events/nearby:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch nearby events", message: error.message });
  }
});

// ==========================================
// EVENT COMMENTS
// ==========================================

// GET /events/:eventId/comments — Get comments for an event
router.get("/events/:eventId/comments", verifyToken, async (req, res) => {
  try {
    const { eventId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = (page - 1) * limit;

    const {
      data: comments,
      error,
      count,
    } = await supabase
      .from("event_comments")
      .select("*", { count: "exact" })
      .eq("event_id", eventId)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Error fetching event comments:", error);
      return res.status(500).json({ error: "Failed to fetch comments" });
    }

    // Enrich with user info
    const userIds = [...new Set((comments || []).map((c) => c.user_id))];
    let userMap = {};
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id, first_name, last_name, avatar_url")
        .in("id", userIds);
      (users || []).forEach((u) => {
        userMap[u.id] = u;
      });
    }

    const enriched = (comments || []).map((c) => {
      const user = userMap[c.user_id] || {};
      return {
        ...c,
        user_first_name: user.first_name || null,
        user_last_name: user.last_name || null,
        user_avatar_url: user.avatar_url || null,
      };
    });

    res.json({ comments: enriched, total: count, page, limit });
  } catch (error) {
    console.error("Error in GET /events/:eventId/comments:", error);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// POST /events/:eventId/comments — Add a comment to an event
router.post("/events/:eventId/comments", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { eventId } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    // Verify event exists
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, creator_id, title")
      .eq("id", eventId)
      .eq("is_deleted", false)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const { data: comment, error } = await supabase
      .from("event_comments")
      .insert({
        event_id: eventId,
        user_id: userId,
        message: message.trim(),
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating event comment:", error);
      return res.status(500).json({ error: "Failed to post comment" });
    }

    // Get commenter info for response
    const { data: user } = await supabase
      .from("users")
      .select("first_name, last_name, avatar_url")
      .eq("id", userId)
      .single();

    const enriched = {
      ...comment,
      user_first_name: user?.first_name || null,
      user_last_name: user?.last_name || null,
      user_avatar_url: user?.avatar_url || null,
    };

    res.status(201).json(enriched);

    // Notify event creator (fire and forget)
    if (event.creator_id !== userId && user) {
      sendNotification(event.creator_id, message.trim().substring(0, 100), {
        title: `${user.first_name} commented on your event 💬`,
        data: {
          type: "event_comment",
          event_id: String(eventId),
          user_id: userId,
          user_name: `${user.first_name} ${user.last_name}`,
        },
      }).catch((err) =>
        console.error("Error sending comment notification:", err),
      );
    }
  } catch (error) {
    console.error("Error in POST /events/:eventId/comments:", error);
    res.status(500).json({ error: "Failed to post comment" });
  }
});

// DELETE /events/:eventId/comments/:commentId — Delete a comment (author or event creator)
router.delete(
  "/events/:eventId/comments/:commentId",
  verifyToken,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const { eventId, commentId } = req.params;

      // Get the comment
      const { data: comment, error: fetchError } = await supabase
        .from("event_comments")
        .select("id, user_id, event_id")
        .eq("id", commentId)
        .eq("event_id", eventId)
        .single();

      if (fetchError || !comment) {
        return res.status(404).json({ error: "Comment not found" });
      }

      // Check authorization: comment author or event creator can delete
      if (comment.user_id !== userId) {
        const { data: event } = await supabase
          .from("events")
          .select("creator_id")
          .eq("id", eventId)
          .single();

        if (!event || event.creator_id !== userId) {
          return res
            .status(403)
            .json({ error: "Not authorized to delete this comment" });
        }
      }

      const { error: deleteError } = await supabase
        .from("event_comments")
        .delete()
        .eq("id", commentId);

      if (deleteError) {
        console.error("Error deleting comment:", deleteError);
        return res.status(500).json({ error: "Failed to delete comment" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error(
        "Error in DELETE /events/:eventId/comments/:commentId:",
        error,
      );
      res.status(500).json({ error: "Failed to delete comment" });
    }
  },
);

// ==========================================
// EVENT INVITATIONS
// ==========================================

// GET /events/:eventId/invitations — Get list of invited user IDs for this event
router.get("/events/:eventId/invitations", verifyToken, async (req, res) => {
  try {
    const { eventId } = req.params;

    const { data, error } = await supabase
      .from("event_invitations")
      .select("invited_user_id")
      .eq("event_id", eventId);

    if (error) throw error;

    const invitedUserIds = (data || []).map((r) => r.invited_user_id);
    res.json({ invited_user_ids: invitedUserIds });
  } catch (error) {
    console.error("Error in GET /events/:eventId/invitations:", error);
    res.status(500).json({ error: "Failed to fetch invitations" });
  }
});

// POST /events/:eventId/invite — Invite friends to an event (persists + sends push notification)
router.post("/events/:eventId/invite", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { eventId } = req.params;
    const { user_ids } = req.body;

    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ error: "user_ids array is required" });
    }

    // Get event info
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, title, event_date, location_name")
      .eq("id", eventId)
      .eq("is_deleted", false)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Get inviter info
    const { data: inviter } = await supabase
      .from("users")
      .select("first_name, last_name, avatar_url")
      .eq("id", userId)
      .single();

    if (!inviter) {
      return res.status(500).json({ error: "Failed to get user info" });
    }

    // Persist invitations (ignore duplicates via onConflict)
    const invitationRows = user_ids.map((uid) => ({
      event_id: eventId,
      invited_user_id: uid,
      invited_by: userId,
    }));
    await supabase
      .from("event_invitations")
      .upsert(invitationRows, { onConflict: "event_id,invited_user_id" });

    // Send push notifications to invited users
    const notificationBody = `${event.title} — ${event.location_name}`;
    const results = await sendNotificationToMany(user_ids, notificationBody, {
      title: `${inviter.first_name} invited you to an event 📅`,
      data: {
        type: "event_invite",
        event_id: String(eventId),
        user_id: userId,
        user_name: `${inviter.first_name} ${inviter.last_name}`,
      },
    });

    // Create in-app notifications
    const notifications = user_ids.map((uid) => ({
      user_id: uid,
      type: "event_invite",
      title: `${inviter.first_name} invited you to an event 📅`,
      body: event.title,
      actor_id: userId,
      actor_name: `${inviter.first_name} ${inviter.last_name}`,
      actor_avatar: inviter.avatar_url,
      reference_id: eventId,
    }));
    await supabase.from("notifications").insert(notifications);

    res.json({ success: true, invited: user_ids.length, results });
  } catch (error) {
    console.error("Error in POST /events/:eventId/invite:", error);
    res.status(500).json({ error: "Failed to send invitations" });
  }
});

// Haversine distance in miles
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = router;
