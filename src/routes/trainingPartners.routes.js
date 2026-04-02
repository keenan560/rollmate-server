const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { optimizeUserImages } = require("../utils/imageOptimization");

// Haversine formula to calculate distance between two points
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in miles
}

// GET /training-partners
// Returns users categorized by availability, gym membership, and proximity
// Optional query params: city, zip_code, radius (default 50 miles)
router.get("/training-partners", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { city, zip_code, radius = 50 } = req.query;
    console.log("Fetching training partners for user:", userId, {
      city,
      zip_code,
      radius,
    });

    // Get blocked user IDs
    const { data: blockData } = await supabase
      .from("blocked_users")
      .select("blocked_user_id, user_id")
      .or(`user_id.eq.${userId},blocked_user_id.eq.${userId}`);

    const blockedIds = new Set();
    if (blockData) {
      blockData.forEach((block) => {
        // Add users I blocked
        if (block.user_id === userId) {
          blockedIds.add(block.blocked_user_id);
        }
        // Add users who blocked me
        if (block.blocked_user_id === userId) {
          blockedIds.add(block.user_id);
        }
      });
    }

    // Get current user's data - extract lat/lng from PostGIS location
    const { data: currentUser, error: userError } = await supabase.rpc(
      "get_user_location",
      {
        user_id: userId,
      },
    );

    if (userError || !currentUser || currentUser.length === 0) {
      console.error("Error fetching current user:", userError);
      return res.status(404).json({ error: "User not found" });
    }

    const userData = currentUser[0];
    const {
      latitude: storedLat,
      longitude: storedLng,
      primary_gym: userGym,
    } = userData;

    // Allow location override from query params (when user searches a different area)
    const userLat = req.query.latitude
      ? parseFloat(req.query.latitude)
      : storedLat;
    const userLng = req.query.longitude
      ? parseFloat(req.query.longitude)
      : storedLng;

    console.log("Current user location:", { userLat, userLng, userGym });

    // Get all other users (excluding current user) - extract lat/lng from PostGIS location
    const { data: allUsers, error: usersError } = await supabase.rpc(
      "get_users_with_location",
      {
        exclude_user_id: userId,
      },
    );

    if (usersError) {
      console.error("Error fetching users:", usersError);
      return res.status(500).json({
        error: "Failed to fetch users",
        message: usersError.message,
      });
    }

    console.log(
      "Total users found (excluding current):",
      allUsers?.length || 0,
    );

    // Filter out blocked users
    let filteredUsers = (allUsers || []).filter(
      (user) => !blockedIds.has(user.id),
    );
    console.log(
      `Filtered out ${(allUsers?.length || 0) - filteredUsers.length} blocked users`,
    );

    // Filter by location if specified
    if (city) {
      filteredUsers = filteredUsers.filter(
        (u) => u.city && u.city.toLowerCase() === city.toLowerCase(),
      );
      console.log(`Filtered to ${filteredUsers.length} users in ${city}`);
    } else if (zip_code) {
      filteredUsers = filteredUsers.filter((u) => u.zip_code === zip_code);
      console.log(
        `Filtered to ${filteredUsers.length} users in zip ${zip_code}`,
      );
    }

    // Categorize users
    const availableNow = [];
    const gymMembers = [];
    const nearby = [];

    filteredUsers.forEach((user) => {
      // Calculate distance if both users have location
      let distance = null;
      if (userLat && userLng && user.latitude && user.longitude) {
        distance = calculateDistance(
          userLat,
          userLng,
          user.latitude,
          user.longitude,
        );
      }

      const userWithDistance = {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        avatar_url: user.avatar_url,
        belt: user.belt,
        primary_gym: user.primary_gym,
        weight: user.weight,
        distance: distance,
        available_now: user.available_now,
        is_online: user.is_online,
        city: user.city,
        zip_code: user.zip_code,
      };

      // Available Now (users with available_now toggle)
      if (user.available_now) {
        availableNow.push(userWithDistance);
      }

      // My Gym (users from same primary gym)
      if (userGym && user.primary_gym === userGym) {
        gymMembers.push(userWithDistance);
      }

      // Nearby (users within specified radius)
      if (distance !== null && distance <= parseFloat(radius)) {
        nearby.push(userWithDistance);
      }
    });

    // Sort by distance
    availableNow.sort(
      (a, b) => (a.distance || Infinity) - (b.distance || Infinity),
    );
    nearby.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
    gymMembers.sort(
      (a, b) => (a.distance || Infinity) - (b.distance || Infinity),
    );

    console.log(
      `Found ${availableNow.length} available, ${gymMembers.length} gym members, ${nearby.length} nearby`,
    );

    // Optimize images in all categories
    res.json({
      availableNow: availableNow.map((user) => optimizeUserImages(user)),
      gymMembers: gymMembers.map((user) => optimizeUserImages(user)),
      nearby: nearby.map((user) => optimizeUserImages(user)),
    });
  } catch (error) {
    console.error("Error fetching training partners:", error);
    res.status(500).json({
      error: "Failed to fetch training partners",
      message: error.message,
    });
  }
});

// GET /training-partners/search-locations
// Typeahead search for cities and zip codes
router.get(
  "/training-partners/search-locations",
  verifyToken,
  async (req, res) => {
    try {
      const { q } = req.query;

      if (!q || q.length < 2) {
        return res.json([]);
      }

      const { data, error } = await supabase.rpc("search_locations", {
        search_query: q,
        result_limit: 10,
      });

      if (error) {
        console.error("Error searching locations:", error);
        return res.status(500).json({ error: "Failed to search locations" });
      }

      res.json(data || []);
    } catch (error) {
      console.error("Error in location search:", error);
      res.status(500).json({ error: "Failed to search locations" });
    }
  },
);

module.exports = router;
