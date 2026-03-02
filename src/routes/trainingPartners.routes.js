const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");

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
router.get("/training-partners", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log("Fetching training partners for user:", userId);

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
      latitude: userLat,
      longitude: userLng,
      primary_gym: userGym,
    } = userData;

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
    console.log(
      "Users with location:",
      allUsers?.filter((u) => u.latitude && u.longitude).length || 0,
    );

    // Categorize users
    const availableNow = [];
    const gymMembers = [];
    const nearby = [];

    (allUsers || []).forEach((user) => {
      // Calculate distance if both users have location
      let distance = null;
      if (userLat && userLng && user.latitude && user.longitude) {
        distance = calculateDistance(
          userLat,
          userLng,
          user.latitude,
          user.longitude,
        );
        console.log(
          `Distance to ${user.first_name} ${user.last_name}:`,
          distance.toFixed(1),
          "miles",
        );
      } else {
        console.log(
          `Skipping ${user.first_name} ${user.last_name} - missing location data`,
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
      };

      // Available Now (users with available_now toggle)
      if (user.available_now) {
        availableNow.push(userWithDistance);
        console.log(`Added ${user.first_name} to Available Now`);
      }

      // My Gym (users from same primary gym)
      if (userGym && user.primary_gym === userGym) {
        gymMembers.push(userWithDistance);
        console.log(`Added ${user.first_name} to My Gym (${user.primary_gym})`);
      }

      // Nearby (users within 50 miles)
      if (distance !== null && distance <= 50) {
        nearby.push(userWithDistance);
        console.log(
          `Added ${user.first_name} to Nearby (${distance.toFixed(1)} mi)`,
        );
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

    res.json({
      availableNow,
      gymMembers,
      nearby,
    });
  } catch (error) {
    console.error("Error fetching training partners:", error);
    res.status(500).json({
      error: "Failed to fetch training partners",
      message: error.message,
    });
  }
});

module.exports = router;
