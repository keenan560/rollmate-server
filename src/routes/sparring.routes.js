const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");

// Helper: calculate IBJJF points for a round
function calcPoints(round) {
  const my =
    (round.my_takedowns || 0) * 2 +
    (round.my_sweeps || 0) * 2 +
    (round.my_passes || 0) * 3 +
    (round.my_mounts || 0) * 4 +
    (round.my_backs || 0) * 4 +
    (round.my_kobs || 0) * 2;

  const their =
    (round.their_takedowns || 0) * 2 +
    (round.their_sweeps || 0) * 2 +
    (round.their_passes || 0) * 3 +
    (round.their_mounts || 0) * 4 +
    (round.their_backs || 0) * 4 +
    (round.their_kobs || 0) * 2;

  return { my, their };
}

// Helper: derive result and counts from submissions array
function deriveSubmissionData(round) {
  const submissions = Array.isArray(round.submissions) ? round.submissions : [];

  const mySubCount = submissions.filter((s) => s.by === "me").length;
  const theirSubCount = submissions.filter((s) => s.by === "them").length;

  // Derive legacy result field for backward compat
  let result = "no_sub";
  if (mySubCount > 0 && theirSubCount === 0) result = "i_subbed";
  else if (theirSubCount > 0 && mySubCount === 0) result = "they_subbed";
  else if (mySubCount > 0 && theirSubCount > 0) result = "i_subbed"; // mixed — user caught more

  // Legacy submission_type — first sub in the list
  const submissionType = submissions.length > 0 ? submissions[0].type : null;

  return { submissions, result, submissionType, mySubCount, theirSubCount };
}

// POST /sparring-sessions — Create a new sparring session with rounds
router.post("/sparring-sessions", verifyToken, async (req, res) => {
  try {
    const { session_date, rounds, notes } = req.body;

    if (!rounds || !Array.isArray(rounds) || rounds.length === 0) {
      return res.status(400).json({ error: "At least one round is required" });
    }

    // Compute session-level totals
    let totalPointsScored = 0;
    let totalPointsConceded = 0;
    let totalSubsByMe = 0;
    let totalSubsByThem = 0;

    const processedRounds = rounds.map((round, index) => {
      const { my, their } = calcPoints(round);
      totalPointsScored += my;
      totalPointsConceded += their;

      // Handle submissions array (new) or fall back to legacy result field
      let subData;
      if (Array.isArray(round.submissions) && round.submissions.length > 0) {
        subData = deriveSubmissionData(round);
      } else {
        // Legacy: single result/submission_type
        const legacyResult = round.result || "no_sub";
        const legacySubs = [];
        if (legacyResult === "i_subbed" && round.submission_type) {
          legacySubs.push({ by: "me", type: round.submission_type });
        } else if (legacyResult === "they_subbed" && round.submission_type) {
          legacySubs.push({ by: "them", type: round.submission_type });
        }
        subData = {
          submissions: legacySubs,
          result: legacyResult,
          submissionType: round.submission_type || null,
          mySubCount: legacyResult === "i_subbed" ? 1 : 0,
          theirSubCount: legacyResult === "they_subbed" ? 1 : 0,
        };
      }

      totalSubsByMe += subData.mySubCount;
      totalSubsByThem += subData.theirSubCount;

      return {
        round_number: index + 1,
        opponent_id: round.opponent_id || null,
        my_takedowns: round.my_takedowns || 0,
        my_sweeps: round.my_sweeps || 0,
        my_passes: round.my_passes || 0,
        my_mounts: round.my_mounts || 0,
        my_backs: round.my_backs || 0,
        my_kobs: round.my_kobs || 0,
        their_takedowns: round.their_takedowns || 0,
        their_sweeps: round.their_sweeps || 0,
        their_passes: round.their_passes || 0,
        their_mounts: round.their_mounts || 0,
        their_backs: round.their_backs || 0,
        their_kobs: round.their_kobs || 0,
        my_points: my,
        their_points: their,
        result: subData.result,
        submission_type: subData.submissionType,
        submissions: subData.submissions,
      };
    });

    // Insert the session
    const { data: session, error: sessionError } = await supabase
      .from("sparring_sessions")
      .insert({
        user_id: req.user.uid,
        session_date: session_date || new Date().toISOString().split("T")[0],
        total_rounds: processedRounds.length,
        total_points_scored: totalPointsScored,
        total_points_conceded: totalPointsConceded,
        total_submissions_by_me: totalSubsByMe,
        total_submissions_by_them: totalSubsByThem,
        notes: notes || null,
      })
      .select()
      .single();

    if (sessionError) throw sessionError;

    // Insert all rounds
    const roundInserts = processedRounds.map((r) => ({
      ...r,
      session_id: session.id,
    }));

    const { data: savedRounds, error: roundsError } = await supabase
      .from("sparring_rounds")
      .insert(roundInserts)
      .select()
      .order("round_number", { ascending: true });

    if (roundsError) throw roundsError;

    // Resolve opponent names
    const opponentIds = [
      ...new Set(
        (savedRounds || [])
          .filter((r) => r.opponent_id)
          .map((r) => r.opponent_id),
      ),
    ];

    let opponentMap = {};
    if (opponentIds.length > 0) {
      const { data: opponents } = await supabase
        .from("users")
        .select("id, first_name, last_name")
        .in("id", opponentIds);
      (opponents || []).forEach((o) => {
        opponentMap[o.id] = `${o.first_name} ${o.last_name}`;
      });
    }

    const enrichedRounds = (savedRounds || []).map((r) => ({
      ...r,
      opponent_name: r.opponent_id ? opponentMap[r.opponent_id] || null : null,
    }));

    res.status(201).json({
      ...session,
      rounds: enrichedRounds,
    });
  } catch (error) {
    console.error("[sparring-sessions] create error:", error.message);
    res.status(500).json({ error: "Failed to create sparring session" });
  }
});

// PUT /sparring-sessions/:id — Update an existing sparring session (replace rounds)
router.put("/sparring-sessions/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { session_date, rounds, notes } = req.body;

    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from("sparring_sessions")
      .select("id, user_id")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: "Sparring session not found" });
    }
    if (existing.user_id !== req.user.uid) {
      return res
        .status(403)
        .json({ error: "Not authorized to update this session" });
    }

    if (!rounds || !Array.isArray(rounds) || rounds.length === 0) {
      return res.status(400).json({ error: "At least one round is required" });
    }

    // Recompute totals
    let totalPointsScored = 0;
    let totalPointsConceded = 0;
    let totalSubsByMe = 0;
    let totalSubsByThem = 0;

    const processedRounds = rounds.map((round, index) => {
      const { my, their } = calcPoints(round);
      totalPointsScored += my;
      totalPointsConceded += their;

      // Handle submissions array (new) or fall back to legacy result field
      let subData;
      if (Array.isArray(round.submissions) && round.submissions.length > 0) {
        subData = deriveSubmissionData(round);
      } else {
        const legacyResult = round.result || "no_sub";
        const legacySubs = [];
        if (legacyResult === "i_subbed" && round.submission_type) {
          legacySubs.push({ by: "me", type: round.submission_type });
        } else if (legacyResult === "they_subbed" && round.submission_type) {
          legacySubs.push({ by: "them", type: round.submission_type });
        }
        subData = {
          submissions: legacySubs,
          result: legacyResult,
          submissionType: round.submission_type || null,
          mySubCount: legacyResult === "i_subbed" ? 1 : 0,
          theirSubCount: legacyResult === "they_subbed" ? 1 : 0,
        };
      }

      totalSubsByMe += subData.mySubCount;
      totalSubsByThem += subData.theirSubCount;

      return {
        round_number: index + 1,
        opponent_id: round.opponent_id || null,
        my_takedowns: round.my_takedowns || 0,
        my_sweeps: round.my_sweeps || 0,
        my_passes: round.my_passes || 0,
        my_mounts: round.my_mounts || 0,
        my_backs: round.my_backs || 0,
        my_kobs: round.my_kobs || 0,
        their_takedowns: round.their_takedowns || 0,
        their_sweeps: round.their_sweeps || 0,
        their_passes: round.their_passes || 0,
        their_mounts: round.their_mounts || 0,
        their_backs: round.their_backs || 0,
        their_kobs: round.their_kobs || 0,
        my_points: my,
        their_points: their,
        result: subData.result,
        submission_type: subData.submissionType,
        submissions: subData.submissions,
      };
    });

    // Update the session
    const { data: session, error: updateError } = await supabase
      .from("sparring_sessions")
      .update({
        session_date: session_date || new Date().toISOString().split("T")[0],
        total_rounds: processedRounds.length,
        total_points_scored: totalPointsScored,
        total_points_conceded: totalPointsConceded,
        total_submissions_by_me: totalSubsByMe,
        total_submissions_by_them: totalSubsByThem,
        notes: notes !== undefined ? notes : null,
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Delete old rounds and insert new ones
    const { error: deleteError } = await supabase
      .from("sparring_rounds")
      .delete()
      .eq("session_id", id);

    if (deleteError) throw deleteError;

    const roundInserts = processedRounds.map((r) => ({
      ...r,
      session_id: id,
    }));

    const { data: savedRounds, error: roundsError } = await supabase
      .from("sparring_rounds")
      .insert(roundInserts)
      .select()
      .order("round_number", { ascending: true });

    if (roundsError) throw roundsError;

    // Resolve opponent names
    const opponentIds = [
      ...new Set(
        (savedRounds || [])
          .filter((r) => r.opponent_id)
          .map((r) => r.opponent_id),
      ),
    ];

    let opponentMap = {};
    if (opponentIds.length > 0) {
      const { data: opponents } = await supabase
        .from("users")
        .select("id, first_name, last_name")
        .in("id", opponentIds);
      (opponents || []).forEach((o) => {
        opponentMap[o.id] = `${o.first_name} ${o.last_name}`;
      });
    }

    const enrichedRounds = (savedRounds || []).map((r) => ({
      ...r,
      opponent_name: r.opponent_id ? opponentMap[r.opponent_id] || null : null,
    }));

    res.status(200).json({
      ...session,
      rounds: enrichedRounds,
    });
  } catch (error) {
    console.error("[sparring-sessions] update error:", error.message);
    res.status(500).json({ error: "Failed to update sparring session" });
  }
});

// GET /sparring-sessions/stats — Aggregate stats for the current user
router.get("/sparring-sessions/stats", verifyToken, async (req, res) => {
  try {
    const { data: sessions, error } = await supabase
      .from("sparring_sessions")
      .select(
        "total_rounds, total_points_scored, total_points_conceded, total_submissions_by_me, total_submissions_by_them",
      )
      .eq("user_id", req.user.uid);

    if (error) throw error;

    const stats = (sessions || []).reduce(
      (acc, s) => ({
        total_sessions: acc.total_sessions + 1,
        total_rounds: acc.total_rounds + s.total_rounds,
        total_points_scored: acc.total_points_scored + s.total_points_scored,
        total_points_conceded:
          acc.total_points_conceded + s.total_points_conceded,
        total_submissions_by_me:
          acc.total_submissions_by_me + s.total_submissions_by_me,
        total_submissions_by_them:
          acc.total_submissions_by_them + s.total_submissions_by_them,
      }),
      {
        total_sessions: 0,
        total_rounds: 0,
        total_points_scored: 0,
        total_points_conceded: 0,
        total_submissions_by_me: 0,
        total_submissions_by_them: 0,
      },
    );

    res.json(stats);
  } catch (error) {
    console.error("[sparring-sessions] stats error:", error.message);
    res.status(500).json({ error: "Failed to fetch sparring stats" });
  }
});

// GET /sparring-sessions — List all sessions for the current user
router.get("/sparring-sessions", verifyToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, error: countError } = await supabase
      .from("sparring_sessions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.user.uid);

    if (countError) throw countError;

    const { data: sessions, error } = await supabase
      .from("sparring_sessions")
      .select("*")
      .eq("user_id", req.user.uid)
      .order("session_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({ sessions: sessions || [], total: count, page, limit });
  } catch (error) {
    console.error("[sparring-sessions] list error:", error.message);
    res.status(500).json({ error: "Failed to fetch sparring sessions" });
  }
});

// GET /sparring-sessions/:id — Get a single session with rounds
router.get("/sparring-sessions/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: session, error: sessionError } = await supabase
      .from("sparring_sessions")
      .select("*")
      .eq("id", id)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({ error: "Sparring session not found" });
    }

    // Only owner can view their session
    if (session.user_id !== req.user.uid) {
      return res
        .status(403)
        .json({ error: "Not authorized to view this session" });
    }

    const { data: rounds, error: roundsError } = await supabase
      .from("sparring_rounds")
      .select("*")
      .eq("session_id", id)
      .order("round_number", { ascending: true });

    if (roundsError) throw roundsError;

    // Resolve opponent names
    const opponentIds = [
      ...new Set(
        (rounds || []).filter((r) => r.opponent_id).map((r) => r.opponent_id),
      ),
    ];

    let opponentMap = {};
    if (opponentIds.length > 0) {
      const { data: opponents } = await supabase
        .from("users")
        .select("id, first_name, last_name")
        .in("id", opponentIds);
      (opponents || []).forEach((o) => {
        opponentMap[o.id] = `${o.first_name} ${o.last_name}`;
      });
    }

    const enrichedRounds = (rounds || []).map((r) => ({
      ...r,
      opponent_name: r.opponent_id ? opponentMap[r.opponent_id] || null : null,
    }));

    res.json({ ...session, rounds: enrichedRounds });
  } catch (error) {
    console.error("[sparring-sessions] get error:", error.message);
    res.status(500).json({ error: "Failed to fetch sparring session" });
  }
});

// DELETE /sparring-sessions/:id — Delete a session and all its rounds
router.delete("/sparring-sessions/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: session, error: fetchError } = await supabase
      .from("sparring_sessions")
      .select("id, user_id")
      .eq("id", id)
      .single();

    if (fetchError || !session) {
      return res.status(404).json({ error: "Sparring session not found" });
    }
    if (session.user_id !== req.user.uid) {
      return res
        .status(403)
        .json({ error: "Not authorized to delete this session" });
    }

    // Rounds cascade-delete via FK, but explicit delete for safety
    await supabase.from("sparring_rounds").delete().eq("session_id", id);

    const { error } = await supabase
      .from("sparring_sessions")
      .delete()
      .eq("id", id);

    if (error) throw error;

    res.json({ message: "Sparring session deleted" });
  } catch (error) {
    console.error("[sparring-sessions] delete error:", error.message);
    res.status(500).json({ error: "Failed to delete sparring session" });
  }
});

module.exports = router;
