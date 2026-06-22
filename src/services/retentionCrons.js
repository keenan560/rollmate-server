/**
 * Retention System — Push Notification Cron Jobs & Event Triggers
 *
 * Cron-based:
 *   - Streak at risk: Daily at 8pm UTC
 *   - Weekly recap ready: Mondays at 9am UTC
 *
 * Event-driven (called from training log POST):
 *   - Rank drop detection
 *   - Friend overtook detection
 *   - Tier promotion / close to next tier
 */

const supabase = require("../../config");
const { sendNotification } = require("./notification");
const { getFriendIds } = require("../utils/social");

// Tier thresholds
const TIERS = [
  { name: "Diamond", min: 20 },
  { name: "Platinum", min: 12 },
  { name: "Gold", min: 8 },
  { name: "Silver", min: 4 },
  { name: "Bronze", min: 0 },
];

function getTierForCount(count) {
  for (const tier of TIERS) {
    if (count >= tier.min) return tier;
  }
  return TIERS[TIERS.length - 1];
}

function getNextTier(count) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (TIERS[i].min > count) return TIERS[i];
  }
  return null;
}

// ─── CRON: Streak at Risk ─────────────────────────────────────────────────────
// Runs daily. Finds users with streak >= 3 who haven't logged in 2+ days.
async function checkStreakAtRisk() {
  console.log("[retention] Checking streak-at-risk notifications...");
  try {
    // Find users with active streaks >= 3
    const { data: users, error } = await supabase
      .from("users")
      .select("id, first_name, current_streak")
      .gte("current_streak", 3);

    if (error || !users || users.length === 0) return;

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = twoDaysAgo.toISOString().split("T")[0];

    let sent = 0;
    for (const user of users) {
      // Check if they've logged in the last 2 days
      const { data: recentLogs } = await supabase
        .from("training_logs")
        .select("id")
        .eq("user_id", user.id)
        .gte("date", twoDaysAgoStr)
        .limit(1);

      if (recentLogs && recentLogs.length > 0) continue;

      // Their streak is at risk — send push
      await sendNotification(
        user.id,
        `Your ${user.current_streak}-day streak is at risk! Train today to keep it alive 🔥`,
        {
          title: `Your ${user.current_streak}-day streak is at risk! 🔥`,
          data: { type: "streak_at_risk" },
        },
      );

      // Also insert in-app notification
      await supabase.from("notifications").insert({
        user_id: user.id,
        type: "streak_at_risk",
        title: `Your ${user.current_streak}-day streak is at risk! 🔥`,
        body: "Train today to keep it alive",
        actor_id: user.id,
        actor_name: user.first_name,
      });

      sent++;
    }

    console.log(`[retention] Streak-at-risk: sent ${sent} notifications`);
  } catch (err) {
    console.error("[retention] Streak-at-risk error:", err.message);
  }
}

// ─── CRON: Weekly Recap Ready ─────────────────────────────────────────────────
// Runs Mondays at 9am. Notifies users who trained last week.
async function notifyWeeklyRecapReady() {
  console.log("[retention] Sending weekly recap notifications...");
  try {
    const now = new Date();
    const lastMonday = new Date(now);
    const dayOfWeek = now.getDay();
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    lastMonday.setDate(now.getDate() - daysSinceMonday - 7);
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);

    const weekStart = lastMonday.toISOString().split("T")[0];
    const weekEnd = lastSunday.toISOString().split("T")[0];

    // Find all users who trained last week
    const { data: logs, error } = await supabase
      .from("training_logs")
      .select("user_id")
      .gte("date", weekStart)
      .lte("date", weekEnd);

    if (error || !logs) return;

    const userIds = [...new Set(logs.map((l) => l.user_id))];
    if (userIds.length === 0) return;

    // Get session counts for the body text
    const userCounts = {};
    logs.forEach((l) => {
      userCounts[l.user_id] = (userCounts[l.user_id] || 0) + 1;
    });

    let sent = 0;
    for (const userId of userIds) {
      const count = userCounts[userId] || 0;
      await sendNotification(
        userId,
        `${count} session${count > 1 ? "s" : ""} last week — see how you stacked up`,
        {
          title: "Your weekly recap is ready 📊",
          data: { type: "weekly_recap_ready" },
        },
      );

      await supabase.from("notifications").insert({
        user_id: userId,
        type: "weekly_recap_ready",
        title: "Your weekly recap is ready 📊",
        body: `${count} session${count > 1 ? "s" : ""} last week — see how you stacked up`,
        actor_id: userId,
      });

      sent++;
    }

    console.log(`[retention] Weekly recap: sent ${sent} notifications`);
  } catch (err) {
    console.error("[retention] Weekly recap error:", err.message);
  }
}

// ─── EVENT: Post-Session Retention Checks ─────────────────────────────────────
// Called after a training log is created. Checks for tier promotions,
// close-to-next-tier, friend overtook, and rank drops affecting others.
async function onSessionLogged(userId) {
  try {
    await Promise.allSettled([
      checkTierProgress(userId),
      checkFriendOvertook(userId),
    ]);
  } catch (err) {
    console.error("[retention] onSessionLogged error:", err.message);
  }
}

// Check if this session pushed the user to a new tier or close to one
async function checkTierProgress(userId) {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const { count: sessionsThisMonth } = await supabase
      .from("training_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("date", startOfMonth.toISOString().split("T")[0]);

    const count = sessionsThisMonth || 0;
    const currentTier = getTierForCount(count);
    const previousTier = getTierForCount(count - 1); // what tier were they before this session?

    // Tier promotion: they just crossed a threshold
    if (currentTier.name !== previousTier.name) {
      const { data: user } = await supabase
        .from("users")
        .select("first_name")
        .eq("id", userId)
        .single();

      await sendNotification(
        userId,
        `${count} sessions this month — keep the momentum going`,
        {
          title: `🎉 You've reached ${currentTier.name} tier!`,
          data: { type: "tier_promotion" },
        },
      );

      await supabase.from("notifications").insert({
        user_id: userId,
        type: "tier_promotion",
        title: `🎉 You've reached ${currentTier.name} tier!`,
        body: `${count} sessions this month — keep the momentum going`,
        actor_id: userId,
        actor_name: user?.first_name || "",
      });

      return; // Don't also send close-to-next-tier
    }

    // Close to next tier: 1-2 sessions away
    const nextTier = getNextTier(count);
    if (nextTier) {
      const sessionsNeeded = nextTier.min - count;
      if (sessionsNeeded <= 2 && sessionsNeeded > 0) {
        // Only send this once per threshold approach (check nudge_history)
        const recentKey = `close_${nextTier.name}_${now.getMonth()}`;
        const { data: existing } = await supabase
          .from("nudge_history")
          .select("id")
          .eq("user_id", userId)
          .eq("nudge_type", recentKey)
          .limit(1);

        if (existing && existing.length > 0) return; // Already notified

        await sendNotification(userId, `You're almost there — don't stop now`, {
          title: `Just ${sessionsNeeded} more session${sessionsNeeded > 1 ? "s" : ""} to ${nextTier.name}! 💪`,
          data: { type: "close_to_next_tier" },
        });

        await supabase.from("notifications").insert({
          user_id: userId,
          type: "close_to_next_tier",
          title: `Just ${sessionsNeeded} more session${sessionsNeeded > 1 ? "s" : ""} to ${nextTier.name}! 💪`,
          body: "You're almost there — don't stop now",
          actor_id: userId,
        });

        // Record so we don't spam
        await supabase.from("nudge_history").insert({
          user_id: userId,
          nudge_type: recentKey,
        });
      }
    }
  } catch (err) {
    console.error("[retention] checkTierProgress error:", err.message);
  }
}

// Check if this user's new session caused them to overtake a friend
async function checkFriendOvertook(userId) {
  try {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split("T")[0];

    const friendIds = await getFriendIds(userId);
    if (friendIds.length === 0) return;

    // Get this week's session counts for user and friends
    const allIds = [userId, ...friendIds];
    const { data: logs } = await supabase
      .from("training_logs")
      .select("user_id")
      .in("user_id", allIds)
      .gte("date", weekAgoStr);

    if (!logs) return;

    const counts = {};
    logs.forEach((l) => {
      counts[l.user_id] = (counts[l.user_id] || 0) + 1;
    });

    const userCount = counts[userId] || 0;

    // Also check what counts were BEFORE this session (user had one less)
    const userCountBefore = userCount - 1;

    // Find friends who the user just passed
    const { data: userData } = await supabase
      .from("users")
      .select("first_name")
      .eq("id", userId)
      .single();

    const userName = userData?.first_name || "Someone";

    for (const friendId of friendIds.slice(0, 30)) {
      const friendCount = counts[friendId] || 0;

      // User just passed this friend: user was at or below, now above
      if (userCountBefore <= friendCount && userCount > friendCount) {
        // Notify the friend that they got overtaken
        await sendNotification(
          friendId,
          `${userName} just passed you on the sessions leaderboard!`,
          {
            title: `${userName} just passed you! 👀`,
            data: { type: "leaderboard_friend_overtook" },
          },
        );

        await supabase.from("notifications").insert({
          user_id: friendId,
          type: "leaderboard_friend_overtook",
          title: `${userName} just passed you! 👀`,
          body: `${userName} just passed you on the sessions leaderboard!`,
          actor_id: userId,
          actor_name: userName,
        });

        // Only notify one friend per session to avoid spam
        break;
      }
    }
  } catch (err) {
    console.error("[retention] checkFriendOvertook error:", err.message);
  }
}

// ─── CRON: Rank Drop Detection ────────────────────────────────────────────────
// Runs daily. Compares current week's rankings to last snapshot.
// Users who dropped 2+ positions get notified.
async function checkRankDrops() {
  console.log("[retention] Checking rank drop notifications...");
  try {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    const twoWeeksAgo = new Date(weekAgo);
    twoWeeksAgo.setDate(weekAgo.getDate() - 7);

    const weekAgoStr = weekAgo.toISOString().split("T")[0];
    const twoWeeksAgoStr = twoWeeksAgo.toISOString().split("T")[0];

    // This week's rankings
    const { data: thisWeekLogs } = await supabase
      .from("training_logs")
      .select("user_id")
      .gte("date", weekAgoStr);

    // Last week's rankings
    const { data: lastWeekLogs } = await supabase
      .from("training_logs")
      .select("user_id")
      .gte("date", twoWeeksAgoStr)
      .lt("date", weekAgoStr);

    if (!thisWeekLogs || !lastWeekLogs) return;

    const thisWeekCounts = {};
    thisWeekLogs.forEach((l) => {
      thisWeekCounts[l.user_id] = (thisWeekCounts[l.user_id] || 0) + 1;
    });

    const lastWeekCounts = {};
    lastWeekLogs.forEach((l) => {
      lastWeekCounts[l.user_id] = (lastWeekCounts[l.user_id] || 0) + 1;
    });

    const thisWeekRanked = Object.entries(thisWeekCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([id], i) => ({ id, rank: i + 1 }));

    const lastWeekRanked = Object.entries(lastWeekCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([id], i) => ({ id, rank: i + 1 }));

    const lastWeekRankMap = new Map(lastWeekRanked.map((e) => [e.id, e.rank]));

    let sent = 0;
    for (const entry of thisWeekRanked) {
      const prevRank = lastWeekRankMap.get(entry.id);
      if (prevRank === undefined) continue; // new user, no drop

      const drop = entry.rank - prevRank; // positive = dropped
      if (drop >= 2) {
        await sendNotification(
          entry.id,
          `You were #${prevRank} last week. Log a session to climb back.`,
          {
            title: `You dropped to #${entry.rank}! 📉`,
            data: { type: "leaderboard_rank_drop" },
          },
        );

        await supabase.from("notifications").insert({
          user_id: entry.id,
          type: "leaderboard_rank_drop",
          title: `You dropped to #${entry.rank}! 📉`,
          body: `You were #${prevRank} last week. Log a session to climb back.`,
          actor_id: entry.id,
        });

        sent++;
      }
    }

    console.log(`[retention] Rank drop: sent ${sent} notifications`);
  } catch (err) {
    console.error("[retention] Rank drop error:", err.message);
  }
}

module.exports = {
  checkStreakAtRisk,
  notifyWeeklyRecapReady,
  checkRankDrops,
  onSessionLogged,
};
