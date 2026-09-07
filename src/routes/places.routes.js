const express = require("express");
const router = express.Router();
const {
  Client,
  PlaceAutocompleteType,
} = require("@googlemaps/google-maps-services-js");
const { verifyToken } = require("../middleware/auth");

const googleMapsClient = new Client({});
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// Google's Autocomplete `types` request param only accepts coarse buckets
// (establishment/geocode/address/regions/cities) — there's no "gym" or
// "martial arts" option to ask for up front. So we ask for `establishment`
// (any business) and drop obviously-irrelevant results afterward using the
// category tags Google *does* return per result. This is a blocklist, not
// an allowlist requiring "gym" — some legitimate BJJ academies get tagged
// inconsistently (e.g. just "health" or "point_of_interest"), and hiding
// those false-negatives would be worse than an occasional stray result.
const EXCLUDED_PLACE_TYPES = new Set([
  "department_store",
  "supermarket",
  "grocery_or_supermarket",
  "shopping_mall",
  "convenience_store",
  "restaurant",
  "food",
  "meal_takeaway",
  "meal_delivery",
  "cafe",
  "bar",
  "clothing_store",
  "electronics_store",
  "furniture_store",
  "hardware_store",
  "home_goods_store",
  "pharmacy",
  "drugstore",
  "gas_station",
  "car_dealer",
  "car_repair",
  "car_wash",
  "bank",
  "atm",
  "lodging",
  "hospital",
  "doctor",
  "dentist",
  "veterinary_care",
  "school",
  "university",
  "church",
  "place_of_worship",
  "real_estate_agency",
  "insurance_agency",
  "lawyer",
  "accounting",
]);

const isLikelyGymResult = (prediction) =>
  !prediction.types?.some((t) => EXCLUDED_PLACE_TYPES.has(t));

// GET /places/gym-autocomplete
// Text-search-as-you-type for a user's gym, restricted to businesses.
// Pass the same `sessiontoken` on this call and the follow-up
// /places/gym-details call so Google bills the pair as one free
// Autocomplete session instead of per-request.
router.get("/places/gym-autocomplete", verifyToken, async (req, res) => {
  try {
    const { input, sessiontoken, lat, lng } = req.query;

    if (!input || !input.trim()) {
      return res.json({ predictions: [] });
    }

    if (!GOOGLE_PLACES_API_KEY) {
      console.error("GOOGLE_PLACES_API_KEY is not configured");
      return res.status(500).json({
        error: "Google Places API is not configured",
      });
    }

    const params = {
      input,
      types: PlaceAutocompleteType.establishment,
      key: GOOGLE_PLACES_API_KEY,
    };
    if (sessiontoken) params.sessiontoken = sessiontoken;
    if (lat && lng) {
      params.location = { lat: parseFloat(lat), lng: parseFloat(lng) };
      params.radius = 80000; // ~50 miles — bias, not a hard restriction
    }

    const response = await googleMapsClient.placeAutocomplete({
      params,
      timeout: 10000,
    });

    const predictions = (response.data.predictions || []).filter(
      isLikelyGymResult,
    );

    res.json({
      predictions,
      status: response.data.status,
    });
  } catch (error) {
    console.error("Error fetching gym autocomplete:", error);
    res.status(500).json({
      error: "Failed to fetch gym suggestions",
      message: error.message,
    });
  }
});

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
    const { sessiontoken } = req.query;

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

    const params = {
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
    };
    // Pairs this call with the preceding /places/gym-autocomplete call for
    // Google's free session-based Autocomplete pricing — omit only for
    // details lookups that didn't originate from an autocomplete session.
    if (sessiontoken) params.sessiontoken = sessiontoken;

    const response = await googleMapsClient.placeDetails({
      params,
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
