const express = require("express");
const router = express.Router();
const { Client } = require("@googlemaps/google-maps-services-js");
const { verifyToken } = require("../middleware/auth");

const googleMapsClient = new Client({});
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// GET /places/nearby-gyms
// Search for BJJ gyms near a location
router.get("/places/nearby-gyms", verifyToken, async (req, res) => {
  try {
    const { lat, lng, radius = 24140, include_details = false } = req.query; // Default 15 miles in meters

    if (!lat || !lng) {
      return res.status(400).json({
        error: "Latitude and longitude are required",
      });
    }

    if (!GOOGLE_PLACES_API_KEY) {
      console.error("GOOGLE_PLACES_API_KEY is not configured");
      return res.status(500).json({
        error: "Google Places API is not configured",
      });
    }

    console.log(
      `Searching for gyms near lat: ${lat}, lng: ${lng}, radius: ${radius}m`,
    );

    const response = await googleMapsClient.placesNearby({
      params: {
        location: { lat: parseFloat(lat), lng: parseFloat(lng) },
        radius: parseInt(radius),
        keyword: "brazilian jiu jitsu bjj gym",
        key: GOOGLE_PLACES_API_KEY,
      },
      timeout: 10000, // 10 second timeout
    });

    console.log(
      `Found ${response.data.results?.length || 0} gyms, status: ${response.data.status}`,
    );

    let results = response.data.results || [];

    // Optionally fetch details (including website) for each gym
    // WARNING: This increases API costs significantly
    if (include_details === "true" && results.length > 0) {
      console.log(`Fetching details for ${results.length} gyms...`);

      const detailedResults = await Promise.all(
        results.map(async (gym) => {
          try {
            const detailsResponse = await googleMapsClient.placeDetails({
              params: {
                place_id: gym.place_id,
                fields: ["website", "formatted_phone_number", "opening_hours"],
                key: GOOGLE_PLACES_API_KEY,
              },
              timeout: 5000,
            });

            return {
              ...gym,
              website: detailsResponse.data.result?.website,
              phone: detailsResponse.data.result?.formatted_phone_number,
              opening_hours: detailsResponse.data.result?.opening_hours,
            };
          } catch (error) {
            console.error(
              `Error fetching details for ${gym.place_id}:`,
              error.message,
            );
            return gym; // Return gym without details if fetch fails
          }
        }),
      );

      results = detailedResults;
    }

    res.json({
      results: results,
      status: response.data.status,
      next_page_token: response.data.next_page_token,
    });
  } catch (error) {
    console.error("Error searching nearby gyms:", error);
    res.status(500).json({
      error: "Failed to search nearby gyms",
      message: error.message,
    });
  }
});

// GET /places/test-nearby-gyms (NO AUTH - for testing only)
// Remove this endpoint in production!
router.get("/places/test-nearby-gyms", async (req, res) => {
  try {
    const { lat, lng, radius = 24140 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        error: "Latitude and longitude are required",
      });
    }

    if (!GOOGLE_PLACES_API_KEY) {
      console.error("GOOGLE_PLACES_API_KEY is not configured");
      return res.status(500).json({
        error:
          "Google Places API is not configured. Add GOOGLE_PLACES_API_KEY to your .env file",
      });
    }

    console.log(
      `[TEST] Searching for gyms near lat: ${lat}, lng: ${lng}, radius: ${radius}m`,
    );

    const response = await googleMapsClient.placesNearby({
      params: {
        location: { lat: parseFloat(lat), lng: parseFloat(lng) },
        radius: parseInt(radius),
        keyword: "brazilian jiu jitsu bjj gym",
        key: GOOGLE_PLACES_API_KEY,
      },
      timeout: 10000,
    });

    console.log(
      `[TEST] Found ${response.data.results?.length || 0} gyms, status: ${response.data.status}`,
    );

    res.json({
      results: response.data.results || [],
      status: response.data.status,
      next_page_token: response.data.next_page_token,
    });
  } catch (error) {
    console.error("[TEST] Error searching nearby gyms:", error);
    res.status(500).json({
      error: "Failed to search nearby gyms",
      message: error.message,
    });
  }
});

// GET /places/gym-details/:place_id
// Get detailed information about a specific gym
router.get("/places/gym-details/:place_id", verifyToken, async (req, res) => {
  try {
    const { place_id } = req.params;

    if (!place_id) {
      return res.status(400).json({
        error: "Place ID is required",
      });
    }

    if (!GOOGLE_PLACES_API_KEY) {
      return res.status(500).json({
        error: "Google Places API is not configured",
      });
    }

    console.log(`Fetching details for place_id: ${place_id}`);

    const response = await googleMapsClient.placeDetails({
      params: {
        place_id: place_id,
        fields: [
          "name",
          "formatted_address",
          "formatted_phone_number",
          "website",
          "opening_hours",
          "rating",
          "user_ratings_total",
          "photos",
          "geometry",
          "url",
        ],
        key: GOOGLE_PLACES_API_KEY,
      },
      timeout: 10000,
    });

    res.json({
      result: response.data.result,
      status: response.data.status,
    });
  } catch (error) {
    console.error("Error fetching gym details:", error);
    res.status(500).json({
      error: "Failed to fetch gym details",
      message: error.message,
    });
  }
});

// GET /places/photo/:photo_reference
// Get a photo URL for a place photo reference
router.get("/places/photo/:photo_reference", verifyToken, async (req, res) => {
  try {
    const { photo_reference } = req.params;
    const { maxwidth = 400 } = req.query;

    if (!photo_reference) {
      return res.status(400).json({
        error: "Photo reference is required",
      });
    }

    if (!GOOGLE_PLACES_API_KEY) {
      return res.status(500).json({
        error: "Google Places API is not configured",
      });
    }

    // Return the photo URL that the client can use
    const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxwidth}&photo_reference=${photo_reference}&key=${GOOGLE_PLACES_API_KEY}`;

    res.json({
      photo_url: photoUrl,
    });
  } catch (error) {
    console.error("Error generating photo URL:", error);
    res.status(500).json({
      error: "Failed to generate photo URL",
      message: error.message,
    });
  }
});

module.exports = router;
