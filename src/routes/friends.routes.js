const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { optimizeUserImages } = require("../utils/imageOptimization");
const { getFriendIds, getBlockedUserIds } = require("../utils/social");

const FRIEND_FIELDS =
  "id, first_name, last_name, avatar_url, belt, primary_gym";

function parsePaging(req) {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 50);
  return { page, limit, offset: (page - 1) * limit };
}

// Fetch user rows for a list of IDs, preserving the order of `ids`.
async function fetchUsersInOrder(ids, fields = FRIEND_FIELDS) {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("users")
    .select(fields)
    .in("id", ids);
  if (error) throw error;
  const byId = new Map((data || []).map((u) => [u.id, u]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map(optimizeUserImages);
}

// Attach `mutual_count` (friends shared with `viewerId`) to each friend object,
// computed set-based in one DB query regardless of how many friends are listed.
// `excludeId` removes a user (e.g. the profile owner being viewed) from the
// mutual set so they don't count as a mutual on every tile.
async function attachMutualCounts(viewerId, friends, excludeId = null) {
  if (!friends.length) return friends;
  const { data, error } = await supabase.rpc("get_mutual_friend_counts", {
    p_viewer_id: viewerId,
    p_friend_ids: friends.map((f) => f.id),
    p_exclude_id: excludeId,
  });
  if (error) {
    console.error("[friends] get_mutual_friend_counts error:", error.message);
    // Non-fatal: default to 0 so the list still returns.
    return friends.map((f) => ({ ...f, mutual_count: 0 }));
  }
  const countById = new Map(
    (data || []).map((r) => [r.friend_id, Number(r.mutual_count) || 0]),
  );
  return friends.map((f) => ({ ...f, mutual_count: countById.get(f.id) || 0 }));
}

// GET /friends — the current user's friends
router.get("/friends", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { page, limit, offset } = parsePaging(req);

    const blocked = new Set(await getBlockedUserIds(userId));
    const friendIds = (await getFriendIds(userId)).filter(
      (id) => !blocked.has(id),
    );

    const total = friendIds.length;
    const pageIds = friendIds.slice(offset, offset + limit);
    const friends = await attachMutualCounts(
      userId,
      await fetchUsersInOrder(pageIds),
    );

    res.json({ friends, total, page, limit });
  } catch (error) {
    console.error("Error in GET /friends:", error);
    res.status(500).json({ error: "Failed to fetch friends" });
  }
});

// GET /users/:userId/friends — another user's friends (respects privacy)
router.get("/users/:userId/friends", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { userId } = req.params;
    const { page, limit, offset } = parsePaging(req);

    const { data: target, error: targetErr } = await supabase
      .from("users")
      .select("id, is_private")
      .eq("id", userId)
      .single();

    if (targetErr || !target) {
      return res.status(404).json({ error: "User not found" });
    }

    let friendIds = await getFriendIds(userId);

    // Private profiles only expose their friends to themselves or to friends.
    if (target.is_private && currentUserId !== userId) {
      if (!friendIds.includes(currentUserId)) {
        return res
          .status(403)
          .json({ error: "This user's friends list is private" });
      }
    }

    // Hide users the requester has a blocking relationship with.
    const blocked = new Set(await getBlockedUserIds(currentUserId));
    friendIds = friendIds.filter((id) => !blocked.has(id));

    const total = friendIds.length;
    const pageIds = friendIds.slice(offset, offset + limit);
    const friends = await attachMutualCounts(
      currentUserId,
      await fetchUsersInOrder(pageIds),
      userId,
    );

    res.json({ friends, total, page, limit });
  } catch (error) {
    console.error("Error in GET /users/:userId/friends:", error);
    res.status(500).json({ error: "Failed to fetch friends" });
  }
});

// GET /users/:userId/mutual-friends — friends shared by requester and :userId
router.get("/users/:userId/mutual-friends", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { userId } = req.params;

    const [mine, theirs] = await Promise.all([
      getFriendIds(currentUserId),
      getFriendIds(userId),
    ]);

    const theirSet = new Set(theirs);
    const blocked = new Set(await getBlockedUserIds(currentUserId));

    const mutualIds = mine.filter(
      (id) =>
        theirSet.has(id) &&
        id !== currentUserId &&
        id !== userId &&
        !blocked.has(id),
    );

    const mutual_friends = await fetchUsersInOrder(
      mutualIds,
      "id, first_name, last_name, avatar_url, belt",
    );

    res.json({ mutual_friends, total: mutual_friends.length });
  } catch (error) {
    console.error("Error in GET /users/:userId/mutual-friends:", error);
    res.status(500).json({ error: "Failed to fetch mutual friends" });
  }
});

module.exports = router;
