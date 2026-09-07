// One-time backfill: resolve existing free-text primary_gym values to a
// Google Place ID so users training at the same physical gym group
// together on the gym leaderboard, without waiting for everyone to
// re-select their gym through the new Places-backed picker.
//
// A gym name typed without a city ("Gracie Barra") is ambiguous — two
// users with identical text could train at two different physical
// locations. This resolves per-user, biased toward that user's own saved
// location, rather than batch-resolving by matching text alone. Users
// with no saved location, or whose resolved match lands implausibly far
// from where they say they are, get flagged for manual review instead of
// being auto-applied.
//
// Defaults to a DRY RUN — prints what it would do, writes nothing.
// Review the output, then re-run with --apply to actually update the DB.
//
//   node scripts/backfill-gym-place-ids.js            # dry run
//   node scripts/backfill-gym-place-ids.js --apply     # writes

const supabase = require("../config");
const { Client } = require("@googlemaps/google-maps-services-js");

const client = new Client({});
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const APPLY = process.argv.includes("--apply");
const BATCH = 500;
// Flag as needing manual review if the resolved place is further than
// this from the user's own recorded location.
const REVIEW_DISTANCE_MILES = 50;

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

(async () => {
  if (!GOOGLE_PLACES_API_KEY) {
    console.error("GOOGLE_PLACES_API_KEY is not set.");
    process.exit(1);
  }

  console.log(
    APPLY
      ? "Running LIVE — confident matches will be written to the DB.\n"
      : "Dry run — no writes. Pass --apply once you've reviewed the output.\n",
  );

  const { data: users, error } = await supabase
    .from("users")
    .select("id, first_name, last_name, primary_gym, location")
    .is("primary_gym_place_id", null)
    .not("primary_gym", "is", null)
    .neq("primary_gym", "")
    .limit(BATCH);

  if (error) {
    console.error("Failed to load users:", error.message);
    process.exit(1);
  }

  console.log(`Found ${users?.length || 0} user(s) with an unresolved gym.\n`);

  // Cache by (normalized gym text + rounded coords) so users at the same
  // physical gym share one API call instead of one per person.
  const cache = new Map();
  let resolved = 0,
    needsReview = 0,
    skipped = 0,
    failed = 0;

  for (const user of users || []) {
    const gymText = (user.primary_gym || "").trim();
    if (!gymText || gymText.toLowerCase() === "not specified") {
      skipped++;
      continue;
    }

    let coords = null;
    if (user.location) {
      const { data: c } = await supabase.rpc("get_coordinates", {
        geom: user.location,
      });
      if (c) coords = c;
    }

    const cacheKey = `${gymText.toLowerCase()}|${
      coords ? coords.lat.toFixed(2) : "nobias"
    }|${coords ? coords.lng.toFixed(2) : ""}`;
    let result = cache.get(cacheKey);

    if (result === undefined) {
      try {
        const params = {
          input: gymText,
          inputtype: "textquery",
          fields: ["place_id", "name", "formatted_address", "geometry"],
          key: GOOGLE_PLACES_API_KEY,
        };
        if (coords) {
          params.locationbias = `circle:40000@${coords.lat},${coords.lng}`; // ~25mi
        }
        const response = await client.findPlaceFromText({
          params,
          timeout: 10000,
        });
        result = response.data.candidates?.[0] || null;
      } catch (e) {
        console.error(`  ! Lookup failed for "${gymText}": ${e.message}`);
        result = null;
      }
      cache.set(cacheKey, result);
    }

    if (!result) {
      console.log(
        `FAIL    ${user.first_name} ${user.last_name} (${user.id}) — "${gymText}" -> no match`,
      );
      failed++;
      continue;
    }

    let flagged = !coords; // no location to sanity-check against — always review
    if (coords && result.geometry?.location) {
      const dist = haversineMiles(
        coords.lat,
        coords.lng,
        result.geometry.location.lat,
        result.geometry.location.lng,
      );
      if (dist > REVIEW_DISTANCE_MILES) flagged = true;
    }

    console.log(
      `${flagged ? "REVIEW  " : "OK      "}${user.first_name} ${user.last_name} (${user.id}) — "${gymText}" -> ${result.name} [${result.formatted_address}] (${result.place_id})`,
    );
    if (flagged) needsReview++;
    else resolved++;

    if (APPLY && !flagged) {
      const { error: updErr } = await supabase
        .from("users")
        .update({ primary_gym_place_id: result.place_id })
        .eq("id", user.id);
      if (updErr) console.error(`    ! write failed: ${updErr.message}`);
    }
  }

  console.log(
    `\nDone. ${resolved} confident match(es)${
      APPLY ? " written" : " (would write with --apply)"
    }, ${needsReview} flagged for manual review (never auto-written), ${failed} unresolved, ${skipped} skipped (empty/placeholder gym text).`,
  );
  if ((users?.length || 0) === BATCH) {
    console.log("Hit batch limit — run again to process the next batch.");
  }
  process.exit(0);
})();
