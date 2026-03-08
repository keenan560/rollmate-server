const Parser = require("rss-parser");
const supabase = require("../../config");

const parser = new Parser();

// BJJ News Sources
const RSS_FEEDS = [
  {
    name: "Grappling Insider",
    url: "https://grapplinginsider.com/feed/",
    avatar: "https://grapplinginsider.com/favicon.ico",
  },
  {
    name: "BJJ Heroes",
    url: "https://www.bjjheroes.com/feed",
    avatar: "https://www.bjjheroes.com/favicon.ico",
  },
  {
    name: "Graciemag",
    url: "https://graciemag.com/feed",
    avatar: "https://graciemag.com/favicon.ico",
  },
  {
    name: "Grapplearts",
    url: "https://grapplearts.com/feed",
    avatar: "https://grapplearts.com/favicon.ico",
  },
  {
    name: "BJJ Eastern Europe",
    url: "https://bjjee.com/feed",
    avatar: "https://bjjee.com/favicon.ico",
  },
  {
    name: "Jits Magazine",
    url: "https://jitsmagazine.com/feed",
    avatar: "https://jitsmagazine.com/favicon.ico",
  },
  {
    name: "BJJ Fanatics",
    url: "https://bjjfanatics.com/blogs/news.atom",
    avatar: "https://bjjfanatics.com/favicon.ico",
  },
  {
    name: "BJJ World",
    url: "https://bjj-world.com/feed",
    avatar: "https://bjj-world.com/favicon.ico",
  },
  {
    name: "Chewjitsu",
    url: "https://chewjitsu.net/feed",
    avatar: "https://chewjitsu.net/favicon.ico",
  },
  {
    name: "BJJ Globetrotters",
    url: "https://bjjglobetrotters.com/feed",
    avatar: "https://bjjglobetrotters.com/favicon.ico",
  },
];

// Create a system user for news posts (run once)
async function createNewsUser() {
  const { data, error } = await supabase
    .from("users")
    .upsert({
      id: "bjj-news-bot",
      first_name: "BJJ",
      last_name: "News",
      email: "news@rollmate.app",
      avatar_url: "https://i.pravatar.cc/150?img=50",
      gender: "other",
      age: 0,
      weight: 0,
      belt: "black",
      stripes: 4,
      height: 0,
      primary_gym: "RollMate",
      city: "Global",
      location: "POINT(0 0)",
    })
    .select()
    .single();

  if (error) console.error("Error creating news user:", error);
  return data;
}

// Fetch and parse RSS feed
async function fetchRSSFeed(feedUrl) {
  try {
    const feed = await parser.parseURL(feedUrl);
    return feed.items;
  } catch (error) {
    console.error(`Error fetching RSS feed ${feedUrl}:`, error);
    return [];
  }
}

// Check if article already posted (improved duplicate detection)
async function isArticlePosted(articleUrl, articleTitle) {
  // Check by URL first (most reliable)
  const { data: urlMatch, error: urlError } = await supabase
    .from("posts")
    .select("id")
    .eq("user_id", "bjj-news-bot")
    .ilike("content", `%${articleUrl}%`)
    .limit(1);

  if (urlMatch && urlMatch.length > 0) {
    return true;
  }

  // Also check by title to catch duplicates with different URLs
  // Escape special characters in title for SQL LIKE
  const escapedTitle = articleTitle.replace(/[%_]/g, "\\$&").substring(0, 100);

  const { data: titleMatch, error: titleError } = await supabase
    .from("posts")
    .select("id")
    .eq("user_id", "bjj-news-bot")
    .ilike("content", `${escapedTitle}%`)
    .limit(1);

  return titleMatch && titleMatch.length > 0;
}

// Create post from RSS article
async function createNewsPost(article, sourceName) {
  try {
    if (await isArticlePosted(article.link, article.title)) {
      console.log(`Article already posted: ${article.title}`);
      return null;
    }

    let imageUrl = null;
    if (article.enclosure?.url) {
      imageUrl = article.enclosure.url;
    } else if (article.content) {
      const imgMatch = article.content.match(/<img[^>]+src="([^">]+)"/);
      if (imgMatch) imageUrl = imgMatch[1];
    }

    const content = `${article.title}\n\n${
      article.contentSnippet || ""
    }\n\nRead more: ${article.link}\n\n#BJJNews #${sourceName.replace(
      /\s/g,
      "",
    )}`;

    const { data, error } = await supabase
      .from("posts")
      .insert({
        user_id: "bjj-news-bot",
        content: content.substring(0, 1000),
        media_type: imageUrl ? "image" : "none",
        media_url: imageUrl,
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`Created news post: ${article.title}`);
    return data;
  } catch (error) {
    console.error("Error creating news post:", error);
    return null;
  }
}

// Main function to fetch and post news
async function fetchAndPostBJJNews() {
  console.log("Fetching BJJ news...");

  await createNewsUser();

  let totalPosts = 0;

  for (const feed of RSS_FEEDS) {
    console.log(`Fetching from ${feed.name}...`);
    const articles = await fetchRSSFeed(feed.url);
    const recentArticles = articles.slice(0, 3);

    for (const article of recentArticles) {
      const post = await createNewsPost(article, feed.name);
      if (post) totalPosts++;
    }
  }

  console.log(`Posted ${totalPosts} new BJJ news articles`);
  return totalPosts;
}

// Clean up duplicate posts (for development/maintenance)
async function cleanupDuplicatePosts() {
  console.log("Cleaning up duplicate BJJ news posts...");

  try {
    // Get all news posts
    const { data: posts, error } = await supabase
      .from("posts")
      .select("id, content, created_at")
      .eq("user_id", "bjj-news-bot")
      .order("created_at", { ascending: false });

    if (error) throw error;

    console.log(`Found ${posts.length} total news posts`);

    // Track seen URLs and titles
    const seenUrls = new Set();
    const seenTitles = new Set();
    const duplicateIds = [];

    for (const post of posts) {
      // Extract URL from content
      const urlMatch = post.content.match(/Read more: (https?:\/\/[^\s\n]+)/);
      const url = urlMatch ? urlMatch[1] : null;

      // Extract title (first line)
      const title = post.content.split("\n")[0].trim();

      // Check if we've seen this URL or title before
      if ((url && seenUrls.has(url)) || seenTitles.has(title)) {
        duplicateIds.push(post.id);
        console.log(`Duplicate found: ${title.substring(0, 50)}...`);
      } else {
        if (url) seenUrls.add(url);
        seenTitles.add(title);
      }
    }

    // Delete duplicates in batches
    if (duplicateIds.length > 0) {
      console.log(`Deleting ${duplicateIds.length} duplicate posts...`);

      const { error: deleteError } = await supabase
        .from("posts")
        .delete()
        .in("id", duplicateIds);

      if (deleteError) throw deleteError;

      console.log(`Successfully deleted ${duplicateIds.length} duplicates`);
    } else {
      console.log("No duplicates found");
    }

    return duplicateIds.length;
  } catch (error) {
    console.error("Error cleaning up duplicates:", error);
    return 0;
  }
}

module.exports = { fetchAndPostBJJNews, cleanupDuplicatePosts };
