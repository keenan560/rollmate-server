const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { sendNotification } = require("../services/notification");

// POST /training-logs — Create a training log entry
router.post("/training-logs", verifyToken, async (req, res) => {
  try {
    const {
      date,
      duration_minutes,
      training_type,
      intensity,
      techniques_practiced,
      sparring_rounds,
      notes,
      gym_name,
      partner_id,
    } = req.body;

    if (!date || !duration_minutes || !training_type || !intensity) {
      return res.status(400).json({
        error:
          "date, duration_minutes, training_type, and intensity are required",
      });
    }

    const { data, error } = await supabase
      .from("training_logs")
      .insert({
        user_id: req.user.uid,
        date,
        duration_minutes,
        training_type,
        intensity,
        techniques_practiced: techniques_practiced || [],
        sparring_rounds: sparring_rounds || 0,
        notes: notes || "",
        gym_name: gym_name || null,
        partner_id: partner_id || null,
      })
      .select()
      .single();

    if (error) throw error;

    // Resolve partner name if partner was tagged
    if (data.partner_id) {
      const { data: partner } = await supabase
        .from("users")
        .select("first_name, last_name")
        .eq("id", data.partner_id)
        .single();
      if (partner) {
        data.partner_name = `${partner.first_name} ${partner.last_name}`;
      }
    }

    // Fire-and-forget: notify friends about the new session
    (async () => {
      try {
        const { data: user } = await supabase
          .from("users")
          .select("first_name, last_name")
          .eq("id", req.user.uid)
          .single();

        if (!user) return;

        const { data: friends } = await supabase
          .from("roll_requests")
          .select("sender_id, receiver_id")
          .eq("status", "accepted")
          .or(`sender_id.eq.${req.user.uid},receiver_id.eq.${req.user.uid}`);

        if (!friends || friends.length === 0) return;

        const friendIds = friends.map((f) =>
          f.sender_id === req.user.uid ? f.receiver_id : f.sender_id,
        );

        const body = partner_id
          ? `Logged a ${training_type} session with a training partner`
          : `Logged a ${duration_minutes}min ${training_type} session`;

        for (const friendId of friendIds) {
          sendNotification(
            friendId,
            `${user.first_name} just trained 🥋 — ${body}`,
          ).catch(() => {});
        }
      } catch (err) {
        console.error("Error sending training log notifications:", err);
      }
    })();

    res.status(201).json(data);
  } catch (error) {
    console.error("Error creating training log:", error);
    res
      .status(500)
      .json({ error: "Failed to create training log", details: error });
  }
});

// GET /training-logs/recent — Sessions from last 24h, all users (privacy-filtered)
router.get("/training-logs/recent", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    // Get friend IDs
    const { data: friends } = await supabase
      .from("roll_requests")
      .select("sender_id, receiver_id")
      .eq("status", "accepted")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);

    const friendIds = new Set(
      (friends || []).map((f) =>
        f.sender_id === userId ? f.receiver_id : f.sender_id,
      ),
    );

    // Get ALL training logs from last 24 hours
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: logs, error } = await supabase
      .from("training_logs")
      .select("*")
      .gte("date", since)
      .order("date", { ascending: false });

    if (error) throw error;

    // Get user info + privacy status for all log authors
    const userIds = [...new Set((logs || []).map((l) => l.user_id))];
    const { data: users } = await supabase
      .from("users")
      .select("id, first_name, last_name, avatar_url, belt, is_private")
      .in("id", userIds);

    const userMap = {};
    (users || []).forEach((u) => {
      userMap[u.id] = u;
    });

    // Resolve partner names
    const partnerIds = [
      ...new Set(
        (logs || []).filter((l) => l.partner_id).map((l) => l.partner_id),
      ),
    ];
    const partnerMap = {};
    if (partnerIds.length > 0) {
      const { data: partners } = await supabase
        .from("users")
        .select("id, first_name, last_name")
        .in("id", partnerIds);
      (partners || []).forEach((p) => {
        partnerMap[p.id] = `${p.first_name} ${p.last_name}`;
      });
    }

    // Filter: show all public users + friends + self. Hide private non-friends.
    const enriched = (logs || [])
      .filter((log) => {
        const author = userMap[log.user_id];
        if (!author) return false;
        if (log.user_id === userId) return true;
        if (friendIds.has(log.user_id)) return true;
        if (author.is_private) return false;
        return true;
      })
      .map((log) => {
        const user = userMap[log.user_id] || {};
        return {
          ...log,
          user_first_name: user.first_name || "",
          user_last_name: user.last_name || "",
          user_avatar_url: user.avatar_url || null,
          user_belt: user.belt || null,
          partner_name: log.partner_id
            ? partnerMap[log.partner_id] || null
            : null,
        };
      });

    res.status(200).json(enriched);
  } catch (error) {
    console.error("Error fetching recent training logs:", error);
    res.status(500).json({ error: "Failed to fetch recent sessions" });
  }
});

// GET /training-logs — Fetch paginated training logs for the current user
router.get("/training-logs", verifyToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, error: countError } = await supabase
      .from("training_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.user.uid);

    if (countError) throw countError;

    const { data: logs, error } = await supabase
      .from("training_logs")
      .select("*")
      .eq("user_id", req.user.uid)
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Resolve partner names for logs that have a partner_id
    const partnerIds = [
      ...new Set(logs.filter((l) => l.partner_id).map((l) => l.partner_id)),
    ];
    if (partnerIds.length > 0) {
      const { data: partners } = await supabase
        .from("users")
        .select("id, first_name, last_name")
        .in("id", partnerIds);

      if (partners) {
        const partnerMap = {};
        partners.forEach((p) => {
          partnerMap[p.id] = `${p.first_name} ${p.last_name}`;
        });
        logs.forEach((l) => {
          if (l.partner_id && partnerMap[l.partner_id]) {
            l.partner_name = partnerMap[l.partner_id];
          }
        });
      }
    }

    res.status(200).json({ logs, total: count, page, limit });
  } catch (error) {
    console.error("Error fetching training logs:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch training logs", details: error });
  }
});

// GET /training-logs/user/:userId — Fetch recent logs for a specific user (MateOverview)
router.get("/training-logs/user/:userId", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 5;

    const { data: logs, error } = await supabase
      .from("training_logs")
      .select("*")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(limit);

    if (error) throw error;

    // Resolve partner names
    const partnerIds = [
      ...new Set(
        (logs || []).filter((l) => l.partner_id).map((l) => l.partner_id),
      ),
    ];
    const partnerMap = {};
    if (partnerIds.length > 0) {
      const { data: partners } = await supabase
        .from("users")
        .select("id, first_name, last_name")
        .in("id", partnerIds);
      (partners || []).forEach((p) => {
        partnerMap[p.id] = `${p.first_name} ${p.last_name}`;
      });
    }

    const enriched = (logs || []).map((l) => ({
      ...l,
      partner_name: l.partner_id ? partnerMap[l.partner_id] || null : null,
    }));

    res.status(200).json({ logs: enriched });
  } catch (error) {
    console.error("Error fetching user training logs:", error);
    res.status(500).json({ error: "Failed to fetch user training logs" });
  }
});

// DELETE /training-logs/:id — Delete a training log (owner only)
router.delete("/training-logs/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const { data: log, error: fetchError } = await supabase
      .from("training_logs")
      .select("id, user_id")
      .eq("id", id)
      .single();

    if (fetchError || !log) {
      return res.status(404).json({ error: "Training log not found" });
    }

    if (log.user_id !== req.user.uid) {
      return res
        .status(403)
        .json({ error: "Not authorized to delete this log" });
    }

    const { error } = await supabase
      .from("training_logs")
      .delete()
      .eq("id", id);

    if (error) throw error;

    res.status(200).json({ message: "Training log deleted" });
  } catch (error) {
    console.error("Error deleting training log:", error);
    res
      .status(500)
      .json({ error: "Failed to delete training log", details: error });
  }
});

// GET /training-logs/stats — Aggregated stats for the current user
router.get("/training-logs/stats", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    const { data: logs, error } = await supabase
      .from("training_logs")
      .select("date, duration_minutes, techniques_practiced, sparring_rounds")
      .eq("user_id", userId)
      .order("date", { ascending: false });

    if (error) throw error;

    if (!logs || logs.length === 0) {
      return res.status(200).json({
        total_sessions: 0,
        total_minutes: 0,
        sessions_this_week: 0,
        sessions_this_month: 0,
        current_streak: 0,
        longest_streak: 0,
        most_practiced_techniques: [],
        avg_duration: 0,
        avg_rounds: 0,
      });
    }

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const total_sessions = logs.length;
    const total_minutes = logs.reduce(
      (sum, l) => sum + (l.duration_minutes || 0),
      0,
    );
    const totalRounds = logs.reduce(
      (sum, l) => sum + (l.sparring_rounds || 0),
      0,
    );
    const avg_duration = Math.round(total_minutes / total_sessions);
    const avg_rounds = Math.round((totalRounds / total_sessions) * 10) / 10;

    const sessions_this_week = logs.filter(
      (l) => new Date(l.date) >= startOfWeek,
    ).length;

    const sessions_this_month = logs.filter(
      (l) => new Date(l.date) >= startOfMonth,
    ).length;

    // Technique frequency
    const techCount = {};
    logs.forEach((l) => {
      (l.techniques_practiced || []).forEach((t) => {
        techCount[t] = (techCount[t] || 0) + 1;
      });
    });
    const most_practiced_techniques = Object.entries(techCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([technique, count]) => ({ technique, count }));

    // Streak calculation (consecutive days with at least one session)
    const uniqueDays = [
      ...new Set(logs.map((l) => new Date(l.date).toISOString().split("T")[0])),
    ].sort((a, b) => b.localeCompare(a)); // descending

    let current_streak = 0;
    let longest_streak = 0;
    let streak = 0;
    let prevDate = null;

    for (const dayStr of uniqueDays) {
      const day = new Date(dayStr + "T00:00:00Z");
      if (!prevDate) {
        // Check if the most recent session is today or yesterday to start a current streak
        const diffFromToday = Math.floor(
          (now.setHours(0, 0, 0, 0) - day.getTime()) / 86400000,
        );
        if (diffFromToday <= 1) {
          streak = 1;
        } else {
          // Gap from today — no current streak, but keep counting for longest
          streak = 1;
          current_streak = 0;
        }
      } else {
        const diff = Math.floor(
          (prevDate.getTime() - day.getTime()) / 86400000,
        );
        if (diff === 1) {
          streak++;
        } else {
          if (current_streak === 0 && prevDate) {
            // We were still building current streak — finalize it
          }
          longest_streak = Math.max(longest_streak, streak);
          streak = 1;
        }
      }
      prevDate = day;
    }
    longest_streak = Math.max(longest_streak, streak);

    // Determine current streak properly
    if (uniqueDays.length > 0) {
      const mostRecent = new Date(uniqueDays[0] + "T00:00:00Z");
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      const diffFromToday = Math.floor(
        (todayDate.getTime() - mostRecent.getTime()) / 86400000,
      );

      if (diffFromToday <= 1) {
        // Recount current streak from the top
        let cs = 1;
        for (let i = 1; i < uniqueDays.length; i++) {
          const curr = new Date(uniqueDays[i] + "T00:00:00Z");
          const prev = new Date(uniqueDays[i - 1] + "T00:00:00Z");
          const d = Math.floor((prev.getTime() - curr.getTime()) / 86400000);
          if (d === 1) {
            cs++;
          } else {
            break;
          }
        }
        current_streak = cs;
      }
    }

    res.status(200).json({
      total_sessions,
      total_minutes,
      sessions_this_week,
      sessions_this_month,
      current_streak,
      longest_streak,
      most_practiced_techniques,
      avg_duration,
      avg_rounds,
    });
  } catch (error) {
    console.error("Error fetching training log stats:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch training log stats", details: error });
  }
});

module.exports = router;
