const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { sendNotification } = require("../services/notification");
const { onSessionLogged } = require("../services/retentionCrons");

// GET /training-logs/weekly-recap — Weekly recap for the current user
router.get("/training-logs/weekly-recap", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const now = new Date();

    // Calculate last completed week (Monday–Sunday)
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    // Last Monday = start of current week, so previous week starts 7 days before that
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() - daysSinceMonday);
    thisMonday.setHours(0, 0, 0, 0);

    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);

    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(thisMonday.getDate() - 1);

    // Two weeks ago for comparison
    const prevMonday = new Date(lastMonday);
    prevMonday.setDate(lastMonday.getDate() - 7);

    const weekStart = lastMonday.toISOString().split("T")[0];
    const weekEnd = lastSunday.toISOString().split("T")[0];
    const prevWeekStart = prevMonday.toISOString().split("T")[0];
    const prevWeekEnd = new Date(lastMonday.getTime() - 86400000)
      .toISOString()
      .split("T")[0];

    // Fetch this week's and previous week's logs
    const [{ data: thisWeekLogs }, { data: prevWeekLogs }] = await Promise.all([
      supabase
        .from("training_logs")
        .select(
          "date, duration_minutes, sparring_rounds, techniques_practiced, intensity, training_type",
        )
        .eq("user_id", userId)
        .gte("date", weekStart)
        .lte("date", weekEnd)
        .order("date", { ascending: true }),
      supabase
        .from("training_logs")
        .select("date, duration_minutes, sparring_rounds")
        .eq("user_id", userId)
        .gte("date", prevWeekStart)
        .lte("date", prevWeekEnd),
    ]);

    const sessions = thisWeekLogs || [];
    const prevSessions = prevWeekLogs || [];

    if (sessions.length === 0) {
      return res.json({
        week_start: weekStart,
        week_end: weekEnd,
        sessions_count: 0,
        total_minutes: 0,
        sparring_rounds: 0,
        streak_days: 0,
        top_technique: null,
        favorite_day: null,
        avg_intensity: null,
        rank_change: 0,
        current_rank: null,
        percentile: null,
        tier: "bronze",
        tier_progress: 0,
        comparison_message:
          "No sessions last week. Time to get back on the mats!",
        friends_who_trained: 0,
        friend_who_trained_most: null,
      });
    }

    // Basic stats
    const sessions_count = sessions.length;
    const total_minutes = sessions.reduce(
      (sum, s) => sum + (s.duration_minutes || 0),
      0,
    );
    const sparring_rounds = sessions.reduce(
      (sum, s) => sum + (s.sparring_rounds || 0),
      0,
    );

    // Streak days (consecutive days within the week)
    const uniqueDays = [
      ...new Set(sessions.map((s) => s.date.split("T")[0])),
    ].sort();
    let streak_days = 1;
    let maxStreak = 1;
    for (let i = 1; i < uniqueDays.length; i++) {
      const prev = new Date(uniqueDays[i - 1]);
      const curr = new Date(uniqueDays[i]);
      const diff = (curr - prev) / 86400000;
      if (diff === 1) {
        streak_days++;
        maxStreak = Math.max(maxStreak, streak_days);
      } else {
        streak_days = 1;
      }
    }
    streak_days = uniqueDays.length === 1 ? 1 : maxStreak;

    // Top technique
    const techCount = {};
    sessions.forEach((s) => {
      (s.techniques_practiced || []).forEach((t) => {
        techCount[t] = (techCount[t] || 0) + 1;
      });
    });
    const top_technique =
      Object.entries(techCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // Favorite day
    const dayCount = {};
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    sessions.forEach((s) => {
      const d = new Date(s.date).getDay();
      dayCount[d] = (dayCount[d] || 0) + 1;
    });
    const favDayIndex = Object.entries(dayCount).sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0];
    const favorite_day = favDayIndex != null ? dayNames[favDayIndex] : null;

    // Average intensity
    const intensityMap = { light: 1, moderate: 2, hard: 3, competition: 4 };
    const intensityLabels = ["light", "moderate", "hard", "competition"];
    const intensities = sessions
      .map((s) => intensityMap[s.intensity])
      .filter(Boolean);
    const avgIntVal =
      intensities.length > 0
        ? Math.round(
            intensities.reduce((a, b) => a + b, 0) / intensities.length,
          )
        : null;
    const avg_intensity =
      avgIntVal != null ? intensityLabels[avgIntVal - 1] : null;

    // Comparison message
    const prevCount = prevSessions.length;
    let comparison_message;
    if (prevCount === 0) {
      comparison_message = `${sessions_count} sessions — great start!`;
    } else {
      const diff = sessions_count - prevCount;
      const pct = Math.round((Math.abs(diff) / prevCount) * 100);
      if (diff > 0) {
        comparison_message = `${diff} more session${diff > 1 ? "s" : ""} than last week — up ${pct}%!`;
      } else if (diff < 0) {
        comparison_message = `${Math.abs(diff)} fewer session${Math.abs(diff) > 1 ? "s" : ""} than last week — down ${pct}%`;
      } else {
        comparison_message = "Same as last week — consistency is key!";
      }
    }

    // Rank and percentile (all users who trained that week)
    const { data: allWeekLogs } = await supabase
      .from("training_logs")
      .select("user_id")
      .gte("date", weekStart)
      .lte("date", weekEnd);

    const allUserCounts = {};
    (allWeekLogs || []).forEach((l) => {
      allUserCounts[l.user_id] = (allUserCounts[l.user_id] || 0) + 1;
    });

    const allSorted = Object.entries(allUserCounts).sort((a, b) => b[1] - a[1]);
    const current_rank =
      allSorted.findIndex(([id]) => id === userId) + 1 || null;
    const totalActive = allSorted.length;

    // Percentile: what % trained LESS than this user
    const usersWithLess = allSorted.filter(
      ([, count]) => count < sessions_count,
    ).length;
    const percentile =
      totalActive > 1
        ? Math.round((usersWithLess / (totalActive - 1)) * 100)
        : 100;

    // Rank change vs previous week
    const { data: prevAllLogs } = await supabase
      .from("training_logs")
      .select("user_id")
      .gte("date", prevWeekStart)
      .lte("date", prevWeekEnd);

    const prevAllCounts = {};
    (prevAllLogs || []).forEach((l) => {
      prevAllCounts[l.user_id] = (prevAllCounts[l.user_id] || 0) + 1;
    });
    const prevSorted = Object.entries(prevAllCounts).sort(
      (a, b) => b[1] - a[1],
    );
    const prevRank = prevSorted.findIndex(([id]) => id === userId) + 1 || null;
    const rank_change = prevRank && current_rank ? prevRank - current_rank : 0;

    // Tier
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const { count: sessionsThisMonth } = await supabase
      .from("training_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("date", startOfMonth.toISOString().split("T")[0]);

    const tierThresholds = [
      { name: "diamond", min: 20 },
      { name: "platinum", min: 12 },
      { name: "gold", min: 8 },
      { name: "silver", min: 4 },
      { name: "bronze", min: 0 },
    ];
    let tier = "bronze";
    for (const t of tierThresholds) {
      if ((sessionsThisMonth || 0) >= t.min) {
        tier = t.name;
        break;
      }
    }

    // Friends who trained
    const { getFriendIds: getFriendsUtil } = require("../utils/social");
    const friendIds = await getFriendsUtil(userId);
    let friends_who_trained = 0;
    let friend_who_trained_most = null;

    if (friendIds.length > 0) {
      const friendTrainCounts = {};
      (allWeekLogs || []).forEach((l) => {
        if (friendIds.includes(l.user_id)) {
          friendTrainCounts[l.user_id] =
            (friendTrainCounts[l.user_id] || 0) + 1;
        }
      });

      friends_who_trained = Object.keys(friendTrainCounts).length;

      if (friends_who_trained > 0) {
        const topFriendId = Object.entries(friendTrainCounts).sort(
          (a, b) => b[1] - a[1],
        )[0][0];

        const { data: topFriend } = await supabase
          .from("users")
          .select("first_name, last_name")
          .eq("id", topFriendId)
          .single();

        if (topFriend) {
          friend_who_trained_most = `${topFriend.first_name} ${topFriend.last_name}`;
        }
      }
    }

    res.json({
      week_start: weekStart,
      week_end: weekEnd,
      sessions_count,
      total_minutes,
      sparring_rounds,
      streak_days,
      top_technique,
      favorite_day,
      avg_intensity,
      rank_change,
      current_rank,
      percentile,
      tier,
      tier_progress: sessionsThisMonth || 0,
      comparison_message,
      friends_who_trained,
      friend_who_trained_most,
    });
  } catch (error) {
    console.error("[training-logs] weekly-recap error:", error.message);
    res.status(500).json({ error: "Failed to generate weekly recap" });
  }
});

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
      video_study,
    } = req.body;

    if (!date || !duration_minutes || !training_type || !intensity) {
      return res.status(400).json({
        error:
          "date, duration_minutes, training_type, and intensity are required",
      });
    }

    // Validate video_study if provided
    let validatedVideoStudy = null;
    if (training_type === "video_study" && video_study) {
      if (
        video_study.comprehension !== undefined &&
        video_study.comprehension !== null &&
        (!Number.isInteger(video_study.comprehension) ||
          video_study.comprehension < 1 ||
          video_study.comprehension > 5)
      ) {
        return res.status(400).json({
          error: "Comprehension must be between 1 and 5",
        });
      }
      validatedVideoStudy = {
        source: video_study.source || null,
        title: video_study.title || null,
        instructor: video_study.instructor || null,
        url: video_study.url || null,
        chapters_covered: video_study.chapters_covered || null,
        comprehension: video_study.comprehension || null,
      };
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
        video_study: validatedVideoStudy,
      })
      .select()
      .single();

    if (error) throw error;

    // Recalculate and persist user's current streak
    try {
      const { data: userLogs } = await supabase
        .from("training_logs")
        .select("date")
        .eq("user_id", req.user.uid)
        .order("date", { ascending: false });

      const uniqueDays = [
        ...new Set(
          (userLogs || []).map(
            (l) => new Date(l.date).toISOString().split("T")[0],
          ),
        ),
      ].sort((a, b) => b.localeCompare(a));

      let streak = 0;
      if (uniqueDays.length > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const mostRecent = new Date(uniqueDays[0] + "T00:00:00Z");
        const diffFromToday = Math.floor(
          (today.getTime() - mostRecent.getTime()) / 86400000,
        );

        if (diffFromToday <= 1) {
          streak = 1;
          for (let i = 1; i < uniqueDays.length; i++) {
            const curr = new Date(uniqueDays[i] + "T00:00:00Z");
            const prev = new Date(uniqueDays[i - 1] + "T00:00:00Z");
            const d = Math.floor((prev.getTime() - curr.getTime()) / 86400000);
            if (d === 1) {
              streak++;
            } else {
              break;
            }
          }
        }
      }

      await supabase
        .from("users")
        .update({ current_streak: streak })
        .eq("id", req.user.uid);
    } catch (streakErr) {
      console.error("Error updating streak:", streakErr);
      // Non-blocking — don't fail the response
    }

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

    // Fire-and-forget: retention system checks (tier, friend overtook, etc.)
    onSessionLogged(req.user.uid).catch((err) =>
      console.error("[retention] onSessionLogged error:", err.message),
    );

    // Fire-and-forget: notify friends about the new session
    (async () => {
      try {
        const { data: user } = await supabase
          .from("users")
          .select("first_name, last_name, avatar_url")
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

        const trainingTypeLabels = {
          open_mat: "Open Mat",
          gi: "Gi",
          nogi: "No-Gi",
          no_gi: "No-Gi",
          competition_prep: "Comp Prep",
          drilling: "Drilling",
          private: "Private",
          both: "Gi & No-Gi",
          seminar: "Seminar",
          self_study: "Self Study",
          video_study: "Video Study",
        };

        const formattedType =
          trainingTypeLabels[training_type] || training_type;

        const body = partner_id
          ? `Logged a ${formattedType} session with a training partner`
          : `Logged a ${duration_minutes}min ${formattedType} session`;

        // Send push notifications
        for (const friendId of friendIds) {
          sendNotification(
            friendId,
            `${user.first_name} just trained 🥋 — ${body}`,
            {
              title: `${user.first_name} just trained 🥋`,
              data: {
                type: "session",
                training_log_id: String(data.id),
                user_id: req.user.uid,
                user_name: `${user.first_name} ${user.last_name}`,
              },
            },
          ).catch(() => {});
        }

        // Batch insert in-app notifications for all friends
        const notifications = friendIds.map((friendId) => ({
          user_id: friendId,
          type: "training_session",
          title: `${user.first_name} just trained 🥋`,
          body,
          actor_id: req.user.uid,
          actor_name: `${user.first_name} ${user.last_name}`,
          actor_avatar: user.avatar_url || null,
          reference_id: data.id,
        }));

        const { error: notifError } = await supabase
          .from("notifications")
          .insert(notifications);

        if (notifError) {
          console.error("Error inserting friend notifications:", notifError);
        }

        // Notify tagged partner specifically (if not already a friend)
        if (partner_id && !friendIds.includes(partner_id)) {
          const { error: partnerNotifError } = await supabase
            .from("notifications")
            .insert({
              user_id: partner_id,
              type: "tagged_session",
              title: `${user.first_name} tagged you in a session 🏷️`,
              body,
              actor_id: req.user.uid,
              actor_name: `${user.first_name} ${user.last_name}`,
              actor_avatar: user.avatar_url || null,
              reference_id: data.id,
            });

          if (partnerNotifError) {
            console.error(
              "Error inserting partner notification:",
              partnerNotifError,
            );
          }
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

    // Get ALL training logs from last 7 days
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

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

// GET /training-logs/:id — Fetch a single training log by ID
router.get("/training-logs/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: log, error } = await supabase
      .from("training_logs")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !log) {
      return res.status(404).json({ error: "Training log not found" });
    }

    // Resolve partner name if present
    if (log.partner_id) {
      const { data: partner } = await supabase
        .from("users")
        .select("first_name, last_name")
        .eq("id", log.partner_id)
        .single();
      if (partner) {
        log.partner_name = `${partner.first_name} ${partner.last_name}`;
      }
    }

    res.json(log);
  } catch (error) {
    console.error("Error fetching training log:", error);
    res.status(500).json({ error: "Failed to fetch training log" });
  }
});

// PUT /training-logs/:id — Update a training log (owner only)
router.put("/training-logs/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const { data: log, error: fetchError } = await supabase
      .from("training_logs")
      .select("id, user_id, training_type")
      .eq("id", id)
      .single();

    if (fetchError || !log) {
      return res.status(404).json({ error: "Training log not found" });
    }

    if (log.user_id !== req.user.uid) {
      return res
        .status(403)
        .json({ error: "Not authorized to update this log" });
    }

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
      video_study,
    } = req.body;

    const update = {};
    if (date !== undefined) update.date = date;
    if (duration_minutes !== undefined)
      update.duration_minutes = duration_minutes;
    if (training_type !== undefined) update.training_type = training_type;
    if (intensity !== undefined) update.intensity = intensity;
    if (techniques_practiced !== undefined)
      update.techniques_practiced = techniques_practiced;
    if (sparring_rounds !== undefined) update.sparring_rounds = sparring_rounds;
    if (notes !== undefined) update.notes = notes;
    if (gym_name !== undefined) update.gym_name = gym_name;
    if (partner_id !== undefined) update.partner_id = partner_id || null;

    // Handle video_study
    const effectiveType =
      training_type !== undefined ? training_type : log.training_type;
    if (video_study !== undefined) {
      if (effectiveType === "video_study" && video_study) {
        if (
          video_study.comprehension !== undefined &&
          video_study.comprehension !== null &&
          (!Number.isInteger(video_study.comprehension) ||
            video_study.comprehension < 1 ||
            video_study.comprehension > 5)
        ) {
          return res.status(400).json({
            error: "Comprehension must be between 1 and 5",
          });
        }
        update.video_study = {
          source: video_study.source || null,
          title: video_study.title || null,
          instructor: video_study.instructor || null,
          url: video_study.url || null,
          chapters_covered: video_study.chapters_covered || null,
          comprehension: video_study.comprehension || null,
        };
      } else {
        update.video_study = null;
      }
    } else if (training_type !== undefined && training_type !== "video_study") {
      // If training_type changed away from video_study, clear it
      update.video_study = null;
    }

    const { data, error } = await supabase
      .from("training_logs")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // Resolve partner name if present
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

    // Recalculate streak (date may have changed)
    try {
      const { data: userLogs } = await supabase
        .from("training_logs")
        .select("date")
        .eq("user_id", req.user.uid)
        .order("date", { ascending: false });

      const uniqueDays = [
        ...new Set(
          (userLogs || []).map(
            (l) => new Date(l.date).toISOString().split("T")[0],
          ),
        ),
      ].sort((a, b) => b.localeCompare(a));

      let streak = 0;
      if (uniqueDays.length > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const mostRecent = new Date(uniqueDays[0] + "T00:00:00Z");
        const diffFromToday = Math.floor(
          (today.getTime() - mostRecent.getTime()) / 86400000,
        );

        if (diffFromToday <= 1) {
          streak = 1;
          for (let i = 1; i < uniqueDays.length; i++) {
            const curr = new Date(uniqueDays[i] + "T00:00:00Z");
            const prev = new Date(uniqueDays[i - 1] + "T00:00:00Z");
            const d = Math.floor((prev.getTime() - curr.getTime()) / 86400000);
            if (d === 1) {
              streak++;
            } else {
              break;
            }
          }
        }
      }

      await supabase
        .from("users")
        .update({ current_streak: streak })
        .eq("id", req.user.uid);
    } catch (streakErr) {
      console.error("Error updating streak:", streakErr);
    }

    res.status(200).json(data);
  } catch (error) {
    console.error("Error updating training log:", error);
    res
      .status(500)
      .json({ error: "Failed to update training log", details: error });
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
