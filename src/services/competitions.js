const supabase = require("../../config");

// System user ID for competition posts
const COMPETITION_BOT_ID = "competition-bot";

// Create the competition bot user if it doesn't exist
async function createCompetitionBotUser() {
  const { data, error } = await supabase.from("users").upsert(
    {
      id: COMPETITION_BOT_ID,
      first_name: "Competition",
      last_name: "News",
      email: "competitions@rollmate.app",
      avatar_url: "https://i.pravatar.cc/150?img=60",
      gender: "other",
      age: 0,
      weight: 0,
      belt: "black",
      stripes: 0,
      height: 0,
      primary_gym: "RollMate",
      city: "Global",
      location: "POINT(0 0)",
    },
    { onConflict: "id" },
  );

  if (error) console.error("Error creating competition bot user:", error);
  return data;
}

// Curated list of upcoming major BJJ/grappling competitions
// Updated periodically — this is the reliable source since Smoothcomp is a JS SPA
// with no public API. In the future, this can be replaced with a headless browser scraper.
function getUpcomingCompetitions() {
  const now = new Date();

  const events = [
    // ADCC Events
    {
      title: "ADCC US Open - Dallas-Fort Worth, TX",
      url: "https://adcc.smoothcomp.com/en/event/26046",
      location: "Dallas, TX, United States",
      date: "June 20, 2026",
    },
    {
      title: "ADCC Canada Windsor Open",
      url: "https://adcc.smoothcomp.com/en/event/31049",
      location: "Windsor, ON, Canada",
      date: "June 27, 2026",
    },
    {
      title: "ADCC US Open - Miami, FL",
      url: "https://adcc.smoothcomp.com/en/event/28468",
      location: "Miami, FL, United States",
      date: "July 11, 2026",
    },
    {
      title: "ADCC US Open - Austin, TX",
      url: "https://adcc.smoothcomp.com/en/event/30665",
      location: "Austin, TX, United States",
      date: "August 08, 2026",
    },
    {
      title: "ADCC Amateur World Championship 2026",
      url: "https://smoothcomp.com/en/event/29650",
      location: "Kraków, Poland",
      date: "September 11, 2026",
    },
    {
      title: "ADCC US Open - Nashville, TN",
      url: "https://adcc.smoothcomp.com/en/event/31911",
      location: "Nashville, TN, United States",
      date: "September 19, 2026",
    },
    {
      title: "ADCC US Open - New Jersey",
      url: "https://adcc.smoothcomp.com/en/event/31912",
      location: "New Jersey, United States",
      date: "October 17, 2026",
    },
    // Grappling Industries
    {
      title: "Grappling Industries Grand Rapids",
      url: "https://grapplingindustries.smoothcomp.com/en/event/26622",
      location: "Grand Rapids, MI, United States",
      date: "June 06, 2026",
    },
    {
      title: "Grappling Industries DMV",
      url: "https://grapplingindustries.smoothcomp.com/en/event/26191",
      location: "Sterling, VA, United States",
      date: "June 13, 2026",
    },
    {
      title: "Grappling Industries Milwaukee",
      url: "https://grapplingindustries.smoothcomp.com/en/event/26162",
      location: "Milwaukee, United States",
      date: "June 20, 2026",
    },
    {
      title: "Grappling Industries Pittsburgh",
      url: "https://grapplingindustries.smoothcomp.com/en/event/26148",
      location: "Pittsburgh, PA, United States",
      date: "June 27, 2026",
    },
    {
      title: "Grappling Industries Boston",
      url: "https://grapplingindustries.smoothcomp.com/en/event/25157",
      location: "Boston, MA, United States",
      date: "July 11, 2026",
    },
    {
      title: "Grappling Industries Philadelphia",
      url: "https://grapplingindustries.smoothcomp.com/en/event/25940",
      location: "Philadelphia, United States",
      date: "July 18, 2026",
    },
    {
      title: "Grappling Industries Chicago",
      url: "https://grapplingindustries.smoothcomp.com/en/event/25435",
      location: "Chicago, IL, United States",
      date: "July 25, 2026",
    },
    // NAGA
    {
      title: "NAGA Virginia Beach Grappling Championship",
      url: "https://naga.smoothcomp.com/en/event/30871",
      location: "Virginia Beach, VA, United States",
      date: "June 06, 2026",
    },
    {
      title: "NAGA Connecticut Grappling Championship",
      url: "https://naga.smoothcomp.com/en/event/30870",
      location: "Newtown, CT, United States",
      date: "June 13, 2026",
    },
    {
      title: "NAGA Boston Grappling Championship",
      url: "https://naga.smoothcomp.com/en/event/30875",
      location: "Hanover, United States",
      date: "June 20, 2026",
    },
    {
      title: "NAGA Cincinnati Grappling Championship",
      url: "https://naga.smoothcomp.com/en/event/30881",
      location: "Cincinnati, OH, United States",
      date: "June 27, 2026",
    },
    {
      title: "NAGA U.S. National Grappling Championship",
      url: "https://naga.smoothcomp.com/en/event/30888",
      location: "Foley, AL, United States",
      date: "July 25, 2026",
    },
    // Newbreed (Southeast US)
    {
      title: "Newbreed Memphis Summer Championship",
      url: "https://newbreedbjj.smoothcomp.com/en/event/28562",
      location: "Memphis, TN, United States",
      date: "June 13, 2026",
    },
    {
      title: "Newbreed Chicago Summer Championship",
      url: "https://newbreedbjj.smoothcomp.com/en/event/27864",
      location: "Oak Lawn, IL, United States",
      date: "June 13, 2026",
    },
    {
      title: "Newbreed Baltimore Summer Championship",
      url: "https://newbreedbjj.smoothcomp.com/en/event/29878",
      location: "Baltimore, MD, United States",
      date: "June 27, 2026",
    },
    {
      title: "Newbreed Nashville Fall Championship",
      url: "https://newbreedbjj.smoothcomp.com/en/event/28569",
      location: "Nashville, TN, United States",
      date: "October 03, 2026",
    },
    // FUJI BJJ
    {
      title: "FUJI BJJ 2026 Kentucky State Championship",
      url: "https://fujibjj.smoothcomp.com/en/event/28565",
      location: "Lexington, KY, United States",
      date: "June 20, 2026",
    },
    {
      title: "FUJI BJJ Eastern Tennessee Summer Championship",
      url: "https://fujibjj.smoothcomp.com/en/event/31725",
      location: "Kingsport, TN, United States",
      date: "June 20, 2026",
    },
    {
      title: "FUJI BJJ Indianapolis Summer Championship",
      url: "https://fujibjj.smoothcomp.com/en/event/28856",
      location: "Noblesville, IN, United States",
      date: "June 27, 2026",
    },
    {
      title: "FUJI BJJ World Championship",
      url: "https://fujibjj.smoothcomp.com/en/event/31023",
      location: "Fishers, IN, United States",
      date: "October 10, 2026",
    },
    // AGF
    {
      title: "2026 AGF Kansas City Championships",
      url: "https://agf.smoothcomp.com/en/event/31443",
      location: "Kansas City, MO, United States",
      date: "June 13, 2026",
    },
    {
      title: "2026 AGF Arkansas Open",
      url: "https://agf.smoothcomp.com/en/event/27869",
      location: "Conway, AR, United States",
      date: "June 27, 2026",
    },
    {
      title: "2026 AGF Tulsa Open",
      url: "https://agf.smoothcomp.com/en/event/28891",
      location: "Tulsa, OK, United States",
      date: "July 11, 2026",
    },
    // Good Fight
    {
      title: "Good Fight: Virginia Summer Open",
      url: "https://goodfight.smoothcomp.com/en/event/29907",
      location: "Fredericksburg, VA, United States",
      date: "June 20, 2026",
    },
    {
      title: "Good Fight: AL Summer Open",
      url: "https://goodfight.smoothcomp.com/en/event/31003",
      location: "Owens Cross Roads, AL, United States",
      date: "June 27, 2026",
    },
    // Tap Cancer Out
    {
      title: "Tap Cancer Out 2026 Nashville BJJ Open",
      url: "https://smoothcomp.com/en/event/28600",
      location: "Nashville, TN, United States",
      date: "September 19, 2026",
    },
    {
      title: "Tap Cancer Out 2026 Columbus BJJ Open",
      url: "https://smoothcomp.com/en/event/27999",
      location: "Columbus, OH, United States",
      date: "June 20, 2026",
    },
    // Nashville Summer Games
    {
      title: "The 2026 Nashville Summer Games",
      url: "https://grappling-games.smoothcomp.com/en/event/32564",
      location: "Nashville, TN, United States",
      date: "August 01, 2026",
    },
  ];

  // Filter to only future events
  return events.filter((e) => {
    try {
      const eventDate = new Date(e.date);
      return eventDate >= now;
    } catch {
      return true;
    }
  });
}

// Check if a competition event has already been posted
async function isCompetitionPosted(eventUrl) {
  const { data } = await supabase
    .from("posts")
    .select("id")
    .eq("user_id", COMPETITION_BOT_ID)
    .ilike("content", `%${eventUrl}%`)
    .limit(1);

  return data && data.length > 0;
}

// Create a post for a competition event
async function createCompetitionPost(event) {
  try {
    if (await isCompetitionPosted(event.url)) {
      return null;
    }

    const content = `🏆 ${event.title}\n\n📍 ${event.location}\n📅 ${event.date}\n\n🔗 Register: ${event.url}\n\n#Competition #BJJTournament`;

    const { data, error } = await supabase
      .from("posts")
      .insert({
        user_id: COMPETITION_BOT_ID,
        content: content.substring(0, 1000),
        media_type: "none",
        media_url: null,
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`Created competition post: ${event.title}`);
    return data;
  } catch (error) {
    console.error("Error creating competition post:", error);
    return null;
  }
}

// Main function: fetch and post upcoming competitions
async function fetchAndPostCompetitions() {
  console.log("Fetching BJJ competitions...");

  await createCompetitionBotUser();

  try {
    const events = getUpcomingCompetitions();
    console.log(`Found ${events.length} upcoming BJJ competition events`);

    let totalPosts = 0;

    for (const event of events) {
      const post = await createCompetitionPost(event);
      if (post) totalPosts++;
    }

    console.log(`Posted ${totalPosts} new competition events`);
    return totalPosts;
  } catch (error) {
    console.error("Error fetching competitions:", error);
    return 0;
  }
}

// Purge old competition posts (older than 14 days)
async function purgeOldCompetitionPosts(retentionDays = 14) {
  console.log(`Purging competition posts older than ${retentionDays} days...`);

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const { data, error } = await supabase
      .from("posts")
      .delete()
      .eq("user_id", COMPETITION_BOT_ID)
      .lt("created_at", cutoffDate.toISOString())
      .select("id");

    if (error) throw error;

    const deleted = data ? data.length : 0;
    console.log(`Purged ${deleted} old competition posts`);
    return deleted;
  } catch (error) {
    console.error("Error purging old competition posts:", error);
    return 0;
  }
}

module.exports = {
  fetchAndPostCompetitions,
  purgeOldCompetitionPosts,
};
