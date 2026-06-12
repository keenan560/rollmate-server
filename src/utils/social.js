// Shared helpers for friendship + blocking, derived from existing tables.
//
// "Friendship" has no first-class model: it's an accepted roll_requests row
// between two users. There can be more than one accepted row between the same
// pair (historical), so results are de-duplicated.

const supabase = require("../../config");

// Returns the user IDs this user is friends with, most-recent-friendship first.
async function getFriendIds(userId) {
  const { data, error } = await supabase
    .from("roll_requests")
    .select("sender_id, receiver_id, created_at")
    .eq("status", "accepted")
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[social] getFriendIds error:", error.message);
    return [];
  }

  const seen = new Set();
  const ordered = [];
  for (const row of data || []) {
    const friendId = row.sender_id === userId ? row.receiver_id : row.sender_id;
    if (friendId && friendId !== userId && !seen.has(friendId)) {
      seen.add(friendId);
      ordered.push(friendId);
    }
  }
  return ordered;
}

// Returns IDs of users in a blocking relationship with this user, in either
// direction (users they blocked + users who blocked them).
async function getBlockedUserIds(userId) {
  const { data, error } = await supabase
    .from("blocked_users")
    .select("user_id, blocked_user_id")
    .or(`user_id.eq.${userId},blocked_user_id.eq.${userId}`);

  if (error) {
    console.error("[social] getBlockedUserIds error:", error.message);
    return [];
  }

  const ids = new Set();
  for (const row of data || []) {
    ids.add(row.user_id === userId ? row.blocked_user_id : row.user_id);
  }
  return [...ids];
}

module.exports = { getFriendIds, getBlockedUserIds };
