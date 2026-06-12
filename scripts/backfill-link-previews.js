// One-time backfill: populate posts.link_preview for existing posts that have
// a URL in their content but no stored preview yet. New posts get this at
// creation; this cleans up the back catalogue so the current feed is instant.
//
// Run once (ideally after running migrations/link_preview_cache_schema.sql so
// fetches are cached):  node scripts/backfill-link-previews.js

const supabase = require("../config");
const { generateLinkPreview } = require("../src/utils/linkPreview");

const BATCH = 200;

(async () => {
  console.log("Backfilling link previews for posts missing them...");

  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, content")
    .is("link_preview", null)
    .eq("is_deleted", false)
    .ilike("content", "%http%")
    .limit(BATCH);

  if (error) {
    console.error("Failed to load posts:", error.message);
    process.exit(1);
  }

  console.log(`Found ${posts?.length || 0} post(s) to process.`);

  let updated = 0;
  for (const post of posts || []) {
    const preview = await generateLinkPreview(post.content);
    if (!preview) continue;

    const { error: updErr } = await supabase
      .from("posts")
      .update({ link_preview: preview })
      .eq("id", post.id);

    if (updErr) {
      console.error(`  ! ${post.id}: ${updErr.message}`);
    } else {
      updated++;
    }
  }

  console.log(`Done. Updated ${updated} post(s).`);
  if ((posts?.length || 0) === BATCH) {
    console.log("Hit batch limit — run again to process the next batch.");
  }
  process.exit(0);
})();
