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

// Check if article already posted
async function isArticlePosted(articleUrl) {
  const { data, error } = await supabase
    .from("posts")
    .select("id")
    .eq("user_id", "bjj-news-bot")
    .ilike("content", `%${articleUrl}%`)
    .single();

  return !!data;
}

// Create post from RSS article
async function createNewsPost(article, sourceName) {
  try {
    if (await isArticlePosted(article.link)) {
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

module.exports = { fetchAndPostBJJNews };
