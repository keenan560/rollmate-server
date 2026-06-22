const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { getFriendIds } = require("../utils/social");

// Tier thresholds (monthly sessions)
const TIERS = [
  { name: "Diamond", min: 20 },
  { name: "Platinum", min: 12 },
  { name: "Gold", min: 8 },
  { name: "Silver", min: 4 },
  { name: "Bronze", min: 0 },
];

function getTier(sessionsThisMonth) {
  for (const tier of TIERS) {
    if (sessionsThisMonth >= tier.min) return tier;
  }
  return TIERS[TIERS.length - 1];
}

function getNextTier(sessionsThisMonth) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (TIERS[i].min > sessionsThisMonth) {
      return TIERS[i];
    }
  }
  return null; // already at Diamond
}

// GET /engagement/nudge — Returns the highest-priority engagement nudge
router.get("/engagement/nudge", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    // Fetch user's current data
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, first_name, current_streak")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return res.json({ type: null, message: null });
    }

    // Priority 1: Streak at risk
    // User has streak >= 3 and hasn't logged in 2+ days
    if (user.current_streak >= 3) {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const twoDaysAgoStr = twoDaysAgo.toISOString().split("T")[0];

      const { data: recentLogs } = await supabase
        .from("training_logs")
        .select("id")
        .eq("user_id", userId)
        .gte("date", twoDaysAgoStr)
        .limit(1);

      if (!recentLogs || recentLogs.length === 0) {
        return res.json({
          type: "streak_at_risk",
          message: `Your ${user.current_streak}-day streak is at risk! Don't let it slip 🔥`,
          cta_label: "Log Session",
          cta_screen: "TrainingLogForm",
          emoji: "🔥",
        });
      }
    }

    // Priority 2: Rank drop (dropped 2+ positions this week vs last week)
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    const twoWeeksAgo = new Date(weekAgo);
    twoWeeksAgo.setDate(weekAgo.getDate() - 7);

    const [{ data: thisWeekLogs }, { data: lastWeekLogs }] = await Promise.all([
      supabase
        .from("training_logs")
        .select("user_id")
        .gte("date", weekAgo.toISOString().split("T")[0]),
      supabase
        .from("training_logs")
        .select("user_id")
        .gte("date", twoWeeksAgo.toISOString().split("T")[0])
        .lt("date", weekAgo.toISOString().split("T")[0]),
    ]);

    // Build rankings for this week and last week
    const thisWeekCounts = {};
    (thisWeekLogs || []).forEach((l) => {
      thisWeekCounts[l.user_id] = (thisWeekCounts[l.user_id] || 0) + 1;
    });
    const lastWeekCounts = {};
    (lastWeekLogs || []).forEach((l) => {
      lastWeekCounts[l.user_id] = (lastWeekCounts[l.user_id] || 0) + 1;
    });

    const thisWeekRanked = Object.entries(thisWeekCounts).sort(
      (a, b) => b[1] - a[1],
    );
    const lastWeekRanked = Object.entries(lastWeekCounts).sort(
      (a, b) => b[1] - a[1],
    );

    const thisWeekRank = thisWeekRanked.findIndex(([id]) => id === userId) + 1;
    const lastWeekRank = lastWeekRanked.findIndex(([id]) => id === userId) + 1;

    if (
      lastWeekRank > 0 &&
      thisWeekRank > 0 &&
      thisWeekRank - lastWeekRank >= 2
    ) {
      return res.json({
        type: "rank_drop",
        message: `You dropped from #${lastWeekRank} to #${thisWeekRank} this week. Log a session to climb back!`,
        cta_label: "View Leaderboard",
        cta_screen: "Leaderboard",
        emoji: "📉",
      });
    }

    // Priority 3: Friend overtook you
    const friendIds = await getFriendIds(userId);
    if (friendIds.length > 0) {
      const userThisWeek = thisWeekCounts[userId] || 0;
      const userLastWeek = lastWeekCounts[userId] || 0;

      for (const friendId of friendIds.slice(0, 20)) {
        const friendThisWeek = thisWeekCounts[friendId] || 0;
        const friendLastWeek = lastWeekCounts[friendId] || 0;

        // Friend passed user this week (they were behind, now ahead)
        if (friendThisWeek > userThisWeek && friendLastWeek <= userLastWeek) {
          const { data: friend } = await supabase
            .from("users")
            .select("first_name")
            .eq("id", friendId)
            .single();

          if (friend) {
            return res.json({
              type: "friend_overtook",
              message: `${friend.first_name} just passed you on the sessions leaderboard!`,
              cta_label: "View Leaderboard",
              cta_screen: "Leaderboard",
              emoji: "👀",
            });
          }
        }
      }
    }

    // Priority 4: Close to next tier
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const { count: sessionsThisMonth } = await supabase
      .from("training_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("date", startOfMonth.toISOString().split("T")[0]);

    const nextTier = getNextTier(sessionsThisMonth || 0);
    if (nextTier) {
      const sessionsNeeded = nextTier.min - (sessionsThisMonth || 0);
      if (sessionsNeeded <= 2 && sessionsNeeded > 0) {
        return res.json({
          type: "close_to_next_tier",
          message: `Just ${sessionsNeeded} more session${sessionsNeeded > 1 ? "s" : ""} to reach ${nextTier.name}! You got this 💪`,
          cta_label: "Log Session",
          cta_screen: "TrainingLogForm",
          emoji: "💪",
        });
      }
    }

    // Priority 5: Weekly recap ready (Monday and user has data from last week)
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday
    if (dayOfWeek === 1) {
      const lastMonday = new Date(now);
      lastMonday.setDate(now.getDate() - 7);
      const lastSunday = new Date(now);
      lastSunday.setDate(now.getDate() - 1);

      const { count: lastWeekCount } = await supabase
        .from("training_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("date", lastMonday.toISOString().split("T")[0])
        .lte("date", lastSunday.toISOString().split("T")[0]);

      if (lastWeekCount > 0) {
        return res.json({
          type: "weekly_recap_ready",
          message: "Your weekly recap is ready! See how you stacked up",
          cta_label: "View Insights",
          cta_screen: "TrainingInsights",
          emoji: "📊",
        });
      }
    }

    // No nudge to show
    res.json({ type: null, message: null });
  } catch (error) {
    console.error("[engagement] nudge error:", error.message);
    res.status(500).json({ error: "Failed to fetch nudge" });
  }
});

module.exports = router;
