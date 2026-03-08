#!/usr/bin/env node

/**
 * Cleanup duplicate BJJ news posts
 * Run with: node scripts/cleanup-duplicates.js
 */

require("dotenv").config();
const supabase = require("../config");

async function cleanupDuplicatePosts() {
  console.log("🧹 Cleaning up duplicate BJJ news posts...\n");

  try {
    // Get all news posts
    const { data: posts, error } = await supabase
      .from("posts")
      .select("id, content, created_at")
      .eq("user_id", "bjj-news-bot")
      .order("created_at", { ascending: false });

    if (error) throw error;

    console.log(`📊 Found ${posts.length} total news posts\n`);

    // Track seen URLs and titles
    const seenUrls = new Set();
    const seenTitles = new Set();
    const duplicateIds = [];
    const duplicateDetails = [];

    for (const post of posts) {
      // Extract URL from content
      const urlMatch = post.content.match(/Read more: (https?:\/\/[^\s\n]+)/);
      const url = urlMatch ? urlMatch[1] : null;

      // Extract title (first line)
      const title = post.content.split("\n")[0].trim();

      // Check if we've seen this URL or title before
      const isDuplicateUrl = url && seenUrls.has(url);
      const isDuplicateTitle = seenTitles.has(title);

      if (isDuplicateUrl || isDuplicateTitle) {
        duplicateIds.push(post.id);
        duplicateDetails.push({
          id: post.id,
          title: title.substring(0, 60),
          reason: isDuplicateUrl ? "duplicate URL" : "duplicate title",
          created_at: post.created_at,
        });
      } else {
        if (url) seenUrls.add(url);
        seenTitles.add(title);
      }
    }

    // Show duplicates found
    if (duplicateDetails.length > 0) {
      console.log(`🔍 Found ${duplicateDetails.length} duplicates:\n`);
      duplicateDetails.forEach((dup, index) => {
        console.log(
          `${index + 1}. [${dup.reason}] ${dup.title}... (${new Date(dup.created_at).toLocaleDateString()})`,
        );
      });
      console.log("");
    }

    // Delete duplicates in batches of 100
    if (duplicateIds.length > 0) {
      console.log(`🗑️  Deleting ${duplicateIds.length} duplicate posts...\n`);

      // Split into batches of 100
      const batchSize = 100;
      let deleted = 0;

      for (let i = 0; i < duplicateIds.length; i += batchSize) {
        const batch = duplicateIds.slice(i, i + batchSize);

        const { error: deleteError } = await supabase
          .from("posts")
          .delete()
          .in("id", batch);

        if (deleteError) {
          console.error(
            `❌ Error deleting batch ${i / batchSize + 1}:`,
            deleteError,
          );
        } else {
          deleted += batch.length;
          console.log(
            `✅ Deleted batch ${i / batchSize + 1} (${batch.length} posts)`,
          );
        }
      }

      console.log(`\n✨ Successfully deleted ${deleted} duplicate posts`);
      console.log(`📈 Remaining posts: ${posts.length - deleted}`);
    } else {
      console.log("✅ No duplicates found! Database is clean.");
    }

    return duplicateIds.length;
  } catch (error) {
    console.error("❌ Error cleaning up duplicates:", error);
    return 0;
  }
}

// Run the cleanup
cleanupDuplicatePosts()
  .then((count) => {
    console.log(`\n🎉 Cleanup complete! Removed ${count} duplicates.`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Cleanup failed:", error);
    process.exit(1);
  });
