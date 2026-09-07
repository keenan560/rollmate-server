const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { getFriendIds, getBlockedUserIds } = require("../utils/social");
const { optimizeUserImages } = require("../utils/imageOptimization");
const { sendNotification } = require("../services/notification");
const { requireSubscription } = require("../middleware/subscription");

const VALID_CATEGORIES = [
  "sessions",
  "mat_time",
  "sparring_rounds",
  "rounds",
  "streak",
  "sparring_points",
  "sparring_subs",
];
const VALID_PERIODS = ["weekly", "monthly", "all_time"];
const CATEGORY_LABELS = {
  sessions: "Sessions",
  mat_time: "Mat Time",
  sparring_rounds: "Sparring",
  rounds: "Sparring",
  streak: "Streak",
  sparring_points: "Points",
  sparring_subs: "Subs",
};

// Normalize category aliases
function normalizeCategory(cat) {
  if (cat === "rounds") return "sparring_rounds";
  return cat;
}

// Build a date filter based on the period
function getPeriodStart(period) {
  const now = new Date();
  if (period === "weekly") {
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    return start.toISOString().split("T")[0];
  }
  if (period === "monthly") {
    const start = new Date(now);
    start.setMonth(now.getMonth() - 1);
    return start.toISOString().split("T")[0];
  }
  return null; // all_time — no date filter
}

// Sum a numeric column on sparring_sessions per user and rank them
async function buildSparringAggregateLeaderboard(field, periodStart, userIds) {
  let query = supabase
    .from("sparring_sessions")
    .select(`user_id, ${field}, session_date`);

  if (periodStart) {
    query = query.gte("session_date", periodStart);
  }
  if (userIds) {
    query = query.in("user_id", userIds);
  }

  const { data: sessions, error } = await query;
  if (error) throw error;

  const userScores = {};
  for (const s of sessions || []) {
    userScores[s.user_id] = (userScores[s.user_id] || 0) + (s[field] || 0);
  }

  const sorted = Object.entries(userScores)
    .map(([uid, score]) => ({ user_id: uid, score }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);

  if (!sorted.length) return [];

  const topIds = sorted.map((e) => e.user_id);
  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("id, first_name, last_name, avatar_url, belt, is_private")
    .in("id", topIds);
  if (usersErr) throw usersErr;

  const userMap = new Map((users || []).map((u) => [u.id, u]));

  return sorted.map((entry, index) => {
    const user = userMap.get(entry.user_id) || {};
    return {
      user_id: entry.user_id,
      first_name: user.first_name || "Unknown",
      last_name: user.last_name || "",
      avatar_url: user.avatar_url || null,
      belt: user.belt || null,
      score: entry.score,
      rank: index + 1,
      is_private: user.is_private || false,
    };
  });
}

// Aggregate training log data into leaderboard scores
async function buildLeaderboard({ category, period, userIds = null }) {
  const periodStart = getPeriodStart(period);

  if (category === "sparring_points") {
    return buildSparringAggregateLeaderboard(
      "total_points_scored",
      periodStart,
      userIds,
    );
  }

  if (category === "sparring_subs") {
    return buildSparringAggregateLeaderboard(
      "total_submissions_by_me",
      periodStart,
      userIds,
    );
  }

  // For streak category, pull directly from users table
  if (category === "streak") {
    let query = supabase
      .from("users")
      .select(
        "id, first_name, last_name, avatar_url, belt, current_streak, is_private",
      )
      .gt("current_streak", 0)
      .order("current_streak", { ascending: false });

    if (userIds) {
      query = query.in("id", userIds);
    }

    const { data, error } = await query.limit(100);
    if (error) throw error;

    return (data || []).map((user, index) => ({
      user_id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      avatar_url: user.avatar_url,
      belt: user.belt,
      score: user.current_streak,
      rank: index + 1,
      is_private: user.is_private,
    }));
  }

  // For other categories, aggregate from training_logs
  // We'll use an RPC function for efficient aggregation
  const rpcName = "get_leaderboard_scores";
  const params = {
    p_category: category,
    p_period_start: periodStart,
    p_user_ids: userIds,
  };

  const { data, error } = await supabase.rpc(rpcName, params);

  if (error) {
    // If the RPC doesn't exist yet, fall back to manual queries
    if (error.code === "42883" || error.message?.includes("function")) {
      return await buildLeaderboardFallback({ category, periodStart, userIds });
    }
    throw error;
  }

  return data || [];
}

// Fallback when RPC function isn't deployed yet
async function buildLeaderboardFallback({ category, periodStart, userIds }) {
  let query = supabase
    .from("training_logs")
    .select("user_id, duration_minutes, sparring_rounds, date");

  if (periodStart) {
    query = query.gte("date", periodStart);
  }

  if (userIds) {
    query = query.in("user_id", userIds);
  }

  const { data: logs, error } = await query;
  if (error) throw error;

  // Aggregate by user
  const userScores = {};
  for (const log of logs || []) {
    if (!userScores[log.user_id]) {
      userScores[log.user_id] = {
        sessions: 0,
        mat_time: 0,
        sparring_rounds: 0,
      };
    }
    userScores[log.user_id].sessions += 1;
    userScores[log.user_id].mat_time += log.duration_minutes || 0;
    userScores[log.user_id].sparring_rounds += log.sparring_rounds || 0;
  }

  // Sort by the requested category
  const sorted = Object.entries(userScores)
    .map(([user_id, scores]) => ({ user_id, score: scores[category] }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);

  // Fetch user profiles for the top entries
  if (!sorted.length) return [];

  const topUserIds = sorted.map((e) => e.user_id);
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, first_name, last_name, avatar_url, belt, is_private")
    .in("id", topUserIds);

  if (usersError) throw usersError;

  const userMap = new Map((users || []).map((u) => [u.id, u]));

  return sorted.map((entry, index) => {
    const user = userMap.get(entry.user_id) || {};
    return {
      user_id: entry.user_id,
      first_name: user.first_name || "Unknown",
      last_name: user.last_name || "",
      avatar_url: user.avatar_url || null,
      belt: user.belt || null,
      score: entry.score,
      rank: index + 1,
      is_private: user.is_private || false,
    };
  });
}

// Get previous period's rankings for trend calculation
async function getPreviousPeriodRanks(category, period, userIds = null) {
  const now = new Date();
  let prevStart, prevEnd;

  if (period === "weekly") {
    prevEnd = new Date(now);
    prevEnd.setDate(now.getDate() - 7);
    prevStart = new Date(prevEnd);
    prevStart.setDate(prevEnd.getDate() - 7);
  } else if (period === "monthly") {
    prevEnd = new Date(now);
    prevEnd.setMonth(now.getMonth() - 1);
    prevStart = new Date(prevEnd);
    prevStart.setMonth(prevEnd.getMonth() - 1);
  } else {
    return new Map(); // no trend for all_time
  }

  const periodStartStr = prevStart.toISOString().split("T")[0];

  if (category === "streak") {
    return new Map(); // streak doesn't have meaningful previous period
  }

  let query = supabase
    .from("training_logs")
    .select("user_id, duration_minutes, sparring_rounds, date")
    .gte("date", periodStartStr)
    .lt("date", prevEnd.toISOString().split("T")[0]);

  if (userIds) {
    query = query.in("user_id", userIds);
  }

  const { data: logs, error } = await query;
  if (error) return new Map();

  const userScores = {};
  for (const log of logs || []) {
    if (!userScores[log.user_id]) {
      userScores[log.user_id] = {
        sessions: 0,
        mat_time: 0,
        sparring_rounds: 0,
      };
    }
    userScores[log.user_id].sessions += 1;
    userScores[log.user_id].mat_time += log.duration_minutes || 0;
    userScores[log.user_id].sparring_rounds += log.sparring_rounds || 0;
  }

  const sorted = Object.entries(userScores)
    .map(([user_id, scores]) => ({ user_id, score: scores[category] }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);

  const rankMap = new Map();
  sorted.forEach((entry, index) => {
    rankMap.set(entry.user_id, index + 1);
  });
  return rankMap;
}

// Attach belt_verified to each entry and, optionally, drop unverified users.
// A single batched lookup regardless of which code path built the entries
// (RPC, aggregate, streak, or fallback) so we don't have to touch every
// individual `users` select above.
async function applyVerification(entries, verifiedOnly) {
  if (!entries.length) return entries;

  const ids = entries.map((e) => e.user_id);
  const { data: rows, error } = await supabase
    .from("users")
    .select("id, belt_verified")
    .in("id", ids);
  if (error) throw error;

  const verifiedMap = new Map((rows || []).map((u) => [u.id, !!u.belt_verified]));
  const withVerification = entries.map((e) => ({
    ...e,
    belt_verified: verifiedMap.get(e.user_id) || false,
  }));

  if (!verifiedOnly) return withVerification;
  return withVerification.filter((e) => e.belt_verified);
}

// Format entries for response, respecting privacy and blocked users
function formatEntries(
  entries,
  blockedIds,
  currentUserId,
  previousRanks = new Map(),
) {
  const blockedSet = new Set(blockedIds);
  const filtered = entries.filter((e) => !blockedSet.has(e.user_id));

  let lastScore = null;
  let lastRank = 0;

  return filtered.map((entry, index) => {
    // Competition ranking: tied scores share the same rank (1, 1, 3 — not 1, 2, 3)
    const rank = entry.score === lastScore ? lastRank : index + 1;
    lastScore = entry.score;
    lastRank = rank;

    const prevRank = previousRanks.get(entry.user_id);
    let trend = "new";
    let rank_change = 0;

    if (prevRank !== undefined) {
      rank_change = prevRank - rank; // positive = moved up
      if (rank_change > 0) trend = "up";
      else if (rank_change < 0) trend = "down";
      else trend = "same";
    }

    const formatted = {
      user_id: entry.user_id,
      first_name: entry.first_name,
      last_name: entry.last_name,
      avatar_url: entry.avatar_url,
      belt: entry.belt,
      belt_verified: entry.belt_verified || false,
      score: entry.score,
      value: entry.score, // alias for frontend compatibility
      rank,
      trend,
      rank_change: Math.abs(rank_change),
      is_current_user: entry.user_id === currentUserId,
    };

    // Optimize avatar
    if (formatted.avatar_url) {
      const optimized = optimizeUserImages(formatted);
      formatted.avatar_url = optimized.avatar_url;
    }

    return formatted;
  });
}

// GET /leaderboard — Global rankings (Pro — gym/friends are the free tiers)
router.get("/leaderboard", verifyToken, requireSubscription, async (req, res) => {
  try {
    const rawCategory = req.query.category || "sessions";
    const period = req.query.period || "weekly";

    if (!VALID_CATEGORIES.includes(rawCategory)) {
      return res.status(400).json({
        error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
      });
    }
    if (!VALID_PERIODS.includes(period)) {
      return res.status(400).json({
        error: `Invalid period. Must be one of: ${VALID_PERIODS.join(", ")}`,
      });
    }

    const category = normalizeCategory(rawCategory);
    const verifiedOnly = req.query.verified_only === "true";
    const userId = req.user.uid;

    const blockedIds = await getBlockedUserIds(userId);

    const [rawEntries, previousRanks] = await Promise.all([
      buildLeaderboard({ category, period }),
      getPreviousPeriodRanks(category, period),
    ]);
    const entries = await applyVerification(rawEntries, verifiedOnly);
    const formatted = formatEntries(entries, blockedIds, userId, previousRanks);

    // Find current user's entry
    const currentUserEntry = formatted.find((e) => e.is_current_user) || null;

    res.json({
      entries: formatted,
      current_user_entry: currentUserEntry,
      category: rawCategory,
      period,
      verified_only: verifiedOnly,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[leaderboard] global error:", error.message);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

// GET /leaderboard/friends — Friends-only rankings
router.get("/leaderboard/friends", verifyToken, async (req, res) => {
  try {
    const rawCategory = req.query.category || "sessions";
    const period = req.query.period || "weekly";

    if (!VALID_CATEGORIES.includes(rawCategory)) {
      return res.status(400).json({
        error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
      });
    }
    if (!VALID_PERIODS.includes(period)) {
      return res.status(400).json({
        error: `Invalid period. Must be one of: ${VALID_PERIODS.join(", ")}`,
      });
    }

    const category = normalizeCategory(rawCategory);
    const verifiedOnly = req.query.verified_only === "true";
    const userId = req.user.uid;

    const [friendIds, blockedIds] = await Promise.all([
      getFriendIds(userId),
      getBlockedUserIds(userId),
    ]);

    // Include current user in friends leaderboard
    const participantIds = [...new Set([userId, ...friendIds])];

    const [rawEntries, previousRanks] = await Promise.all([
      buildLeaderboard({ category, period, userIds: participantIds }),
      getPreviousPeriodRanks(category, period, participantIds),
    ]);
    const entries = await applyVerification(rawEntries, verifiedOnly);
    const formatted = formatEntries(entries, blockedIds, userId, previousRanks);

    const currentUserEntry = formatted.find((e) => e.is_current_user) || null;

    res.json({
      entries: formatted,
      current_user_entry: currentUserEntry,
      category: rawCategory,
      period,
      verified_only: verifiedOnly,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[leaderboard] friends error:", error.message);
    res.status(500).json({ error: "Failed to fetch friends leaderboard" });
  }
});

// GET /leaderboard/gym — Rankings among users at the same gym.
// `primary_gym` is free text (no canonical gyms table), so membership is a
// case-insensitive exact match — typos/variants of the same gym name won't
// group together yet.
router.get("/leaderboard/gym", verifyToken, async (req, res) => {
  try {
    const rawCategory = req.query.category || "sessions";
    const period = req.query.period || "weekly";

    if (!VALID_CATEGORIES.includes(rawCategory)) {
      return res.status(400).json({
        error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
      });
    }
    if (!VALID_PERIODS.includes(period)) {
      return res.status(400).json({
        error: `Invalid period. Must be one of: ${VALID_PERIODS.join(", ")}`,
      });
    }

    const category = normalizeCategory(rawCategory);
    const verifiedOnly = req.query.verified_only === "true";
    const userId = req.user.uid;

    const { data: me, error: meErr } = await supabase
      .from("users")
      .select("primary_gym, primary_gym_place_id")
      .eq("id", userId)
      .single();
    if (meErr) throw meErr;

    const gym = (me?.primary_gym || "").trim();
    const gymPlaceId = me?.primary_gym_place_id || null;
    if ((!gym && !gymPlaceId) || gym.toLowerCase() === "not specified") {
      return res.json({
        entries: [],
        current_user_entry: null,
        category: rawCategory,
        period,
        gym: null,
        verified_only: verifiedOnly,
        updated_at: new Date().toISOString(),
      });
    }

    // Prefer grouping by Google Place ID — an exact, unambiguous match so
    // "Gracie Barra Murfreesboro" and "GB Murfreesboro" land in the same
    // group regardless of how each person typed it. Users who haven't
    // re-selected their gym through the Places picker yet don't have a
    // place_id, so fall back to the old free-text match for them.
    const gymUsersQuery = gymPlaceId
      ? supabase
          .from("users")
          .select("id")
          .eq("primary_gym_place_id", gymPlaceId)
      : supabase.from("users").select("id").ilike("primary_gym", gym);

    const [{ data: gymUsers, error: gymErr }, blockedIds] = await Promise.all([
      gymUsersQuery,
      getBlockedUserIds(userId),
    ]);
    if (gymErr) throw gymErr;
    const participantIds = (gymUsers || []).map((u) => u.id);

    const [rawEntries, previousRanks] = await Promise.all([
      buildLeaderboard({ category, period, userIds: participantIds }),
      getPreviousPeriodRanks(category, period, participantIds),
    ]);
    const entries = await applyVerification(rawEntries, verifiedOnly);
    const formatted = formatEntries(entries, blockedIds, userId, previousRanks);

    const currentUserEntry = formatted.find((e) => e.is_current_user) || null;

    res.json({
      entries: formatted,
      current_user_entry: currentUserEntry,
      category: rawCategory,
      period,
      gym,
      verified_only: verifiedOnly,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[leaderboard] gym error:", error.message);
    res.status(500).json({ error: "Failed to fetch gym leaderboard" });
  }
});

// POST /leaderboard/congratulate — send a lightweight "nice one" ping to
// whoever's leading a leaderboard. Reuses the existing notifications table
// and push service; no new schema.
router.post("/leaderboard/congratulate", verifyToken, async (req, res) => {
  try {
    const fromUserId = req.user.uid;
    const { toUserId, category, period, rank } = req.body;

    if (!toUserId) {
      return res.status(400).json({ error: "toUserId is required" });
    }
    if (toUserId === fromUserId) {
      return res.status(400).json({ error: "Can't congratulate yourself" });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: "Invalid category" });
    }
    if (!VALID_PERIODS.includes(period)) {
      return res.status(400).json({ error: "Invalid period" });
    }

    const referenceId = `${category}:${period}`;

    // Don't let the same person spam the same congrats repeatedly for the
    // same standing — one per week is plenty.
    const { data: existing, error: existingErr } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", toUserId)
      .eq("actor_id", fromUserId)
      .eq("type", "leaderboard_congrats")
      .eq("reference_id", referenceId)
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .limit(1);
    if (existingErr) throw existingErr;
    if (existing && existing.length > 0) {
      return res.json({ success: true, alreadySent: true });
    }

    const { data: fromUser, error: fromUserErr } = await supabase
      .from("users")
      .select("first_name, last_name, avatar_url")
      .eq("id", fromUserId)
      .single();
    if (fromUserErr) throw fromUserErr;

    const fromName = fromUser
      ? `${fromUser.first_name} ${fromUser.last_name}`
      : "Someone";
    const categoryLabel = CATEGORY_LABELS[category] || category;
    const rankLabel = rank === 1 ? "taking #1" : `your #${rank || "?"} spot`;
    const periodLabel = period === "all_time" ? "all-time" : period;

    const { error: insertErr } = await supabase.from("notifications").insert({
      user_id: toUserId,
      type: "leaderboard_congrats",
      title: `${fromName} congratulated you! 🎉`,
      body: `For ${rankLabel} in ${categoryLabel} this ${periodLabel}.`,
      actor_id: fromUserId,
      actor_name: fromName,
      actor_avatar: fromUser?.avatar_url || null,
      reference_id: referenceId,
    });
    if (insertErr) throw insertErr;

    sendNotification(
      toUserId,
      `${fromName} congratulated you for ${rankLabel} in ${categoryLabel}!`,
      { title: "🎉 Nice one!", data: { type: "leaderboard_congrats" } },
    ).catch((err) =>
      console.error("[leaderboard] congrats push error:", err.message),
    );

    res.json({ success: true });
  } catch (error) {
    console.error("[leaderboard] congratulate error:", error.message);
    res.status(500).json({ error: "Failed to send congratulations" });
  }
});

module.exports = router;
