const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");

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
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ message: "Training log created", data });
  } catch (error) {
    console.error("Error creating training log:", error);
    res
      .status(500)
      .json({ error: "Failed to create training log", details: error });
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

    res.status(200).json({ logs, total: count, page, limit });
  } catch (error) {
    console.error("Error fetching training logs:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch training logs", details: error });
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
