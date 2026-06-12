// Clean posts whose image URLs point to dead/staging hosts (e.g. the
// *.cloudwaysapps.com leak) that fail to load on devices and cause the feed's
// image-retry/flicker loop.
//
// - bad media_url   → media_url=null, media_type='none'
// - bad link_preview.image → image set to null (title/description kept)
//
// Runs against whatever SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY point to.
//   node scripts/clean-bad-image-posts.js        (apply)
//   node scripts/clean-bad-image-posts.js --dry  (preview only)

const supabase = require("../config");
const { isUnsafeImageHost } = require("../src/utils/linkPreview");

const DRY = process.argv.includes("--dry");

(async () => {
  console.log(`Cleaning bad-image posts${DRY ? " (DRY RUN)" : ""}...`);

  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, media_type, media_url, link_preview")
    .eq("is_deleted", false);

  if (error) {
    console.error("Failed to load posts:", error.message);
    process.exit(1);
  }

  let fixedMedia = 0;
  let fixedPreview = 0;

  for (const p of posts || []) {
    const update = {};

    if (p.media_url && isUnsafeImageHost(p.media_url)) {
      update.media_url = null;
      if (p.media_type === "image") update.media_type = "none";
      fixedMedia++;
    }

    const img = p.link_preview && p.link_preview.image;
    if (img && isUnsafeImageHost(img)) {
      update.link_preview = { ...p.link_preview, image: null };
      fixedPreview++;
    }

    if (Object.keys(update).length === 0) continue;

    console.log(`  ${p.id}: ${JSON.stringify(Object.keys(update))}`);
    if (!DRY) {
      const { error: updErr } = await supabase
        .from("posts")
        .update(update)
        .eq("id", p.id);
      if (updErr) console.error(`    ! ${updErr.message}`);
    }
  }

  console.log(
    `Done. ${DRY ? "Would fix" : "Fixed"} media_url=${fixedMedia}, link_preview.image=${fixedPreview}.`,
  );
  process.exit(0);
})();
