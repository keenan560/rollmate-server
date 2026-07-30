const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { sendNotification } = require("../services/notification");

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

// Maps ScoringEvent.action <-> the flat my_*/their_* columns, in point order
const ACTION_FIELD_MAP = [
  { action: "takedown", myField: "my_takedowns", theirField: "their_takedowns" },
  { action: "sweep", myField: "my_sweeps", theirField: "their_sweeps" },
  { action: "guard_pass", myField: "my_passes", theirField: "their_passes" },
  { action: "mount", myField: "my_mounts", theirField: "their_mounts" },
  { action: "back_take", myField: "my_backs", theirField: "their_backs" },
  { action: "knee_on_belly", myField: "my_kobs", theirField: "their_kobs" },
];

// Helper: expand flat my_*/their_* count columns into ScoringEvent[] (count > 0 only)
function toScoringEvents(round, side) {
  const field = side === "my" ? "myField" : "theirField";
  return ACTION_FIELD_MAP.filter((m) => (round[m[field]] || 0) > 0).map((m) => ({
    action: m.action,
    count: round[m[field]],
  }));
}

// Helper: shape a raw sparring_rounds row into the frontend's SparringRound contract,
// keeping the original flat columns for backward compat
function formatRound(round, opponentMap) {
  const opponent = round.opponent_id
    ? opponentMap[round.opponent_id] || null
    : null;
  // Fall back to the free-text name when the opponent isn't a Roll Mate user
  const resolvedName = opponent ? opponent.name : round.guest_opponent_name || null;
  return {
    ...round,
    opponent_name: resolvedName,
    partner_id: round.opponent_id || null,
    partner_name: resolvedName,
    partner_avatar_url: opponent ? opponent.avatar_url : null,
    opponent_avatar_url: opponent ? opponent.avatar_url : null,
    opponent_belt: opponent ? opponent.belt : null,
    my_scores: toScoringEvents(round, "my"),
    their_scores: toScoringEvents(round, "their"),
    submissions: Array.isArray(round.submissions) ? round.submissions : [],
  };
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

// Flag rounds logged against a known Rollmate opponent as pending cross-credit,
// and notify that opponent so they can adopt it into their own log.
async function notifyOpponentsOfCredit(loggerId, loggerUser, savedRounds) {
  const creditable = (savedRounds || []).filter(
    (r) => r.opponent_id && r.opponent_id !== loggerId,
  );
  if (creditable.length === 0 || !loggerUser) return;

  const ids = creditable.map((r) => r.id);
  const { error: statusError } = await supabase
    .from("sparring_rounds")
    .update({ credit_status: "pending" })
    .in("id", ids);

  if (statusError) {
    console.error("[sparring] Error flagging pending credit:", statusError);
    return;
  }

  const loggerName = `${loggerUser.first_name} ${loggerUser.last_name}`;

  const notifications = creditable.map((r) => {
    const subs = Array.isArray(r.submissions) ? r.submissions : [];
    const gotSubbed = subs.some((s) => s.by === "me");
    const subLine = gotSubbed
      ? ` — caught with a ${(r.submission_type || "submission").replace(/_/g, " ")}`
      : "";
    return {
      user_id: r.opponent_id,
      type: "sparring_round_credit",
      title: `${loggerName} logged a round with you`,
      body: `${r.my_points}-${r.their_points}${subLine}. Tap to add it to your log.`,
      actor_id: loggerId,
      actor_name: loggerName,
      actor_avatar: loggerUser.avatar_url || null,
      reference_id: r.id,
    };
  });

  const { error: notifError } = await supabase
    .from("notifications")
    .insert(notifications);

  if (notifError) {
    console.error("[sparring] Error inserting credit notifications:", notifError);
  }

  for (const r of creditable) {
    sendNotification(r.opponent_id, `${loggerName} logged a round with you`, {
      title: `${loggerName} logged a round with you`,
      data: { type: "sparring_round_credit", round_id: String(r.id) },
    }).catch(() => {});
  }
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
        guest_opponent_name: round.opponent_id ? null : (round.opponent_name || null),
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
        .select("id, first_name, last_name, avatar_url, belt")
        .in("id", opponentIds);
      (opponents || []).forEach((o) => {
        opponentMap[o.id] = {
          name: `${o.first_name} ${o.last_name}`,
          avatar_url: o.avatar_url || null,
          belt: o.belt || null,
        };
      });
    }

    const enrichedRounds = (savedRounds || []).map((r) => formatRound(r, opponentMap));

    res.status(201).json({
      ...session,
      rounds: enrichedRounds,
    });

    // Fire-and-forget: notify friends about the sparring session
    (async () => {
      try {
        const { data: user } = await supabase
          .from("users")
          .select("first_name, last_name, avatar_url")
          .eq("id", req.user.uid)
          .single();

        if (!user) return;

        // Notify any known Rollmate opponents so they can adopt these rounds
        notifyOpponentsOfCredit(req.user.uid, user, savedRounds).catch((err) =>
          console.error("[sparring] credit notify error:", err.message),
        );

        const { data: friends } = await supabase
          .from("roll_requests")
          .select("sender_id, receiver_id")
          .eq("status", "accepted")
          .or(`sender_id.eq.${req.user.uid},receiver_id.eq.${req.user.uid}`);

        if (!friends || friends.length === 0) return;

        const friendIds = friends.map((f) =>
          f.sender_id === req.user.uid ? f.receiver_id : f.sender_id,
        );

        const roundCount = processedRounds.length;
        const subText =
          totalSubsByMe > 0
            ? `, ${totalSubsByMe} sub${totalSubsByMe > 1 ? "s" : ""}`
            : "";
        const body = `${roundCount} round${roundCount > 1 ? "s" : ""} — ${totalPointsScored} pts scored${subText}`;

        // Send push notifications
        for (const friendId of friendIds) {
          sendNotification(
            friendId,
            `${user.first_name} just sparred 🥊 — ${body}`,
            {
              title: `${user.first_name} just sparred 🥊`,
              data: {
                type: "sparring_session",
                sparring_session_id: String(session.id),
                user_id: req.user.uid,
                user_name: `${user.first_name} ${user.last_name}`,
              },
            },
          ).catch(() => {});
        }

        // Batch insert in-app notifications
        const notifications = friendIds.map((friendId) => ({
          user_id: friendId,
          type: "sparring_session",
          title: `${user.first_name} just sparred 🥊`,
          body,
          actor_id: req.user.uid,
          actor_name: `${user.first_name} ${user.last_name}`,
          actor_avatar: user.avatar_url || null,
          reference_id: session.id,
        }));

        const { error: notifError } = await supabase
          .from("notifications")
          .insert(notifications);

        if (notifError) {
          console.error(
            "[sparring] Error inserting friend notifications:",
            notifError,
          );
        }
      } catch (err) {
        console.error("[sparring] Error sending notifications:", err.message);
      }
    })();
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
        guest_opponent_name: round.opponent_id ? null : (round.opponent_name || null),
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
        .select("id, first_name, last_name, avatar_url, belt")
        .in("id", opponentIds);
      (opponents || []).forEach((o) => {
        opponentMap[o.id] = {
          name: `${o.first_name} ${o.last_name}`,
          avatar_url: o.avatar_url || null,
          belt: o.belt || null,
        };
      });
    }

    const enrichedRounds = (savedRounds || []).map((r) => formatRound(r, opponentMap));

    res.status(200).json({
      ...session,
      rounds: enrichedRounds,
    });

    // Fire-and-forget: notify any known Rollmate opponents about the edited rounds
    (async () => {
      try {
        const { data: user } = await supabase
          .from("users")
          .select("first_name, last_name, avatar_url")
          .eq("id", req.user.uid)
          .single();
        if (!user) return;
        await notifyOpponentsOfCredit(req.user.uid, user, savedRounds);
      } catch (err) {
        console.error("[sparring] credit notify error:", err.message);
      }
    })();
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

    const sessionIds = (sessions || []).map((s) => s.id);

    let roundsBySession = {};
    if (sessionIds.length > 0) {
      const { data: rounds, error: roundsError } = await supabase
        .from("sparring_rounds")
        .select("*")
        .in("session_id", sessionIds)
        .order("round_number", { ascending: true });

      if (roundsError) throw roundsError;

      const opponentIds = [
        ...new Set(
          (rounds || []).filter((r) => r.opponent_id).map((r) => r.opponent_id),
        ),
      ];

      let opponentMap = {};
      if (opponentIds.length > 0) {
        const { data: opponents } = await supabase
          .from("users")
          .select("id, first_name, last_name, avatar_url, belt")
          .in("id", opponentIds);
        (opponents || []).forEach((o) => {
          opponentMap[o.id] = {
            name: `${o.first_name} ${o.last_name}`,
            avatar_url: o.avatar_url || null,
            belt: o.belt || null,
          };
        });
      }

      (rounds || []).forEach((r) => {
        const formatted = formatRound(r, opponentMap);
        if (!roundsBySession[r.session_id]) roundsBySession[r.session_id] = [];
        roundsBySession[r.session_id].push(formatted);
      });
    }

    const enrichedSessions = (sessions || []).map((s) => ({
      ...s,
      rounds: roundsBySession[s.id] || [],
    }));

    res.json({ sessions: enrichedSessions, total: count, page, limit });
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
        .select("id, first_name, last_name, avatar_url, belt")
        .in("id", opponentIds);
      (opponents || []).forEach((o) => {
        opponentMap[o.id] = {
          name: `${o.first_name} ${o.last_name}`,
          avatar_url: o.avatar_url || null,
          belt: o.belt || null,
        };
      });
    }

    const enrichedRounds = (rounds || []).map((r) => formatRound(r, opponentMap));

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

// GET /sparring-rounds/:roundId — Detail for the cross-credit review screen
router.get("/sparring-rounds/:roundId", verifyToken, async (req, res) => {
  try {
    const { roundId } = req.params;
    const userId = req.user.uid;

    const { data: round, error } = await supabase
      .from("sparring_rounds")
      .select("*")
      .eq("id", roundId)
      .single();

    if (error || !round) {
      return res.status(404).json({ error: "Round not found" });
    }

    const { data: session, error: sessionError } = await supabase
      .from("sparring_sessions")
      .select("id, user_id, session_date")
      .eq("id", round.session_id)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (round.opponent_id !== userId && session.user_id !== userId) {
      return res.status(403).json({ error: "Not authorized to view this round" });
    }

    const { data: logger } = await supabase
      .from("users")
      .select("id, first_name, last_name, avatar_url, belt")
      .eq("id", session.user_id)
      .single();

    res.json({
      ...round,
      session_date: session.session_date,
      my_scores: toScoringEvents(round, "my"),
      their_scores: toScoringEvents(round, "their"),
      submissions: Array.isArray(round.submissions) ? round.submissions : [],
      logger: logger
        ? {
            id: logger.id,
            name: `${logger.first_name} ${logger.last_name}`,
            avatar_url: logger.avatar_url || null,
            belt: logger.belt || null,
          }
        : null,
    });
  } catch (error) {
    console.error("[sparring-rounds] detail error:", error.message);
    res.status(500).json({ error: "Failed to fetch round" });
  }
});

// POST /sparring-rounds/:roundId/adopt — Mirror a logged round into your own log
router.post("/sparring-rounds/:roundId/adopt", verifyToken, async (req, res) => {
  try {
    const { roundId } = req.params;
    const userId = req.user.uid;

    const { data: round, error } = await supabase
      .from("sparring_rounds")
      .select("*")
      .eq("id", roundId)
      .single();

    if (error || !round) {
      return res.status(404).json({ error: "Round not found" });
    }
    if (round.opponent_id !== userId) {
      return res.status(403).json({ error: "Not authorized to adopt this round" });
    }
    if (round.credit_status !== "pending") {
      return res
        .status(400)
        .json({ error: `Round is already ${round.credit_status}` });
    }

    const { data: originalSession, error: sessionError } = await supabase
      .from("sparring_sessions")
      .select("id, user_id, session_date")
      .eq("id", round.session_id)
      .single();

    if (sessionError || !originalSession) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Find or create the adopter's own session for that date
    let { data: mySession, error: mySessionError } = await supabase
      .from("sparring_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("session_date", originalSession.session_date)
      .maybeSingle();

    if (mySessionError) throw mySessionError;

    if (!mySession) {
      const { data: created, error: createError } = await supabase
        .from("sparring_sessions")
        .insert({
          user_id: userId,
          session_date: originalSession.session_date,
          total_rounds: 0,
          total_points_scored: 0,
          total_points_conceded: 0,
          total_submissions_by_me: 0,
          total_submissions_by_them: 0,
        })
        .select()
        .single();
      if (createError) throw createError;
      mySession = created;
    }

    const { data: lastRound } = await supabase
      .from("sparring_rounds")
      .select("round_number")
      .eq("session_id", mySession.id)
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextRoundNumber = (lastRound?.round_number || 0) + 1;

    // Mirror the round from the adopter's perspective (my/their swapped, subs flipped)
    const flippedSubmissions = (
      Array.isArray(round.submissions) ? round.submissions : []
    ).map((s) => ({ by: s.by === "me" ? "them" : "me", type: s.type }));
    const subData = deriveSubmissionData({ submissions: flippedSubmissions });

    const mirroredRound = {
      session_id: mySession.id,
      round_number: nextRoundNumber,
      opponent_id: originalSession.user_id,
      guest_opponent_name: null,
      my_takedowns: round.their_takedowns,
      my_sweeps: round.their_sweeps,
      my_passes: round.their_passes,
      my_mounts: round.their_mounts,
      my_backs: round.their_backs,
      my_kobs: round.their_kobs,
      their_takedowns: round.my_takedowns,
      their_sweeps: round.my_sweeps,
      their_passes: round.my_passes,
      their_mounts: round.my_mounts,
      their_backs: round.my_backs,
      their_kobs: round.my_kobs,
      my_points: round.their_points,
      their_points: round.my_points,
      result: subData.result,
      submission_type: subData.submissionType,
      submissions: subData.submissions,
      credit_status: "none",
      adopted_from_round_id: round.id,
    };

    const { data: insertedRound, error: insertError } = await supabase
      .from("sparring_rounds")
      .insert(mirroredRound)
      .select()
      .single();
    if (insertError) throw insertError;

    // Recompute the adopter's session totals from all of its rounds
    const { data: allMyRounds, error: allRoundsError } = await supabase
      .from("sparring_rounds")
      .select("my_points, their_points, submissions")
      .eq("session_id", mySession.id);
    if (allRoundsError) throw allRoundsError;

    let totalPointsScored = 0;
    let totalPointsConceded = 0;
    let totalSubsByMe = 0;
    let totalSubsByThem = 0;
    (allMyRounds || []).forEach((r) => {
      totalPointsScored += r.my_points || 0;
      totalPointsConceded += r.their_points || 0;
      const subs = Array.isArray(r.submissions) ? r.submissions : [];
      totalSubsByMe += subs.filter((s) => s.by === "me").length;
      totalSubsByThem += subs.filter((s) => s.by === "them").length;
    });

    await supabase
      .from("sparring_sessions")
      .update({
        total_rounds: (allMyRounds || []).length,
        total_points_scored: totalPointsScored,
        total_points_conceded: totalPointsConceded,
        total_submissions_by_me: totalSubsByMe,
        total_submissions_by_them: totalSubsByThem,
      })
      .eq("id", mySession.id);

    await supabase
      .from("sparring_rounds")
      .update({ credit_status: "adopted" })
      .eq("id", round.id);

    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("type", "sparring_round_credit")
      .eq("reference_id", round.id);

    res.json({ session_id: mySession.id, round: insertedRound });
  } catch (error) {
    console.error("[sparring-rounds] adopt error:", error.message);
    res.status(500).json({ error: "Failed to adopt round" });
  }
});

// POST /sparring-rounds/:roundId/dismiss — Decline a pending cross-credit round
router.post("/sparring-rounds/:roundId/dismiss", verifyToken, async (req, res) => {
  try {
    const { roundId } = req.params;
    const userId = req.user.uid;

    const { data: round, error } = await supabase
      .from("sparring_rounds")
      .select("id, opponent_id, credit_status")
      .eq("id", roundId)
      .single();

    if (error || !round) {
      return res.status(404).json({ error: "Round not found" });
    }
    if (round.opponent_id !== userId) {
      return res.status(403).json({ error: "Not authorized to dismiss this round" });
    }
    if (round.credit_status !== "pending") {
      return res
        .status(400)
        .json({ error: `Round is already ${round.credit_status}` });
    }

    await supabase
      .from("sparring_rounds")
      .update({ credit_status: "dismissed" })
      .eq("id", roundId);

    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("type", "sparring_round_credit")
      .eq("reference_id", roundId);

    res.json({ success: true });
  } catch (error) {
    console.error("[sparring-rounds] dismiss error:", error.message);
    res.status(500).json({ error: "Failed to dismiss round" });
  }
});

module.exports = router;
