const { getLinkPreview } = require("link-preview-js");
const supabase = require("../../config");

// Cache TTLs: articles rarely change, so successes live long; failures are
// short-lived so a transient outage doesn't permanently cache a null.
const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const FAILURE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Collapses concurrent identical requests (e.g. a scroll burst) within this
// process into a single outbound fetch, even before the cache row is written.
const inFlight = new Map();

// Extract URLs from text
const extractUrls = (text) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.match(urlRegex) || [];
};

// Check if URL is YouTube
const isYouTubeUrl = (url) => {
  return /(?:youtube\.com\/watch\?v=|youtu\.be\/)/.test(url);
};

// Reject staging/internal/malformed image hosts that resolve for server-side
// scrapers but fail to resolve on devices — e.g. Cloudways staging hosts like
// "site.com-1590329-6220119.cloudwaysapps.com". A dead cover image is what
// drives the feed's image-retry/flicker loop, so we never store these.
const isUnsafeImageHost = (url) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("cloudwaysapps.com")) return true; // staging host
    if (/\.(com|net|org|io|co)-/.test(host)) return true; // malformed glued host
    return false;
  } catch {
    return true; // unparseable URL → treat as unsafe
  }
};

const isFresh = (fetchedAt, success) => {
  const age = Date.now() - new Date(fetchedAt).getTime();
  return age < (success ? SUCCESS_TTL_MS : FAILURE_TTL_MS);
};

const readCache = async (url) => {
  const { data, error } = await supabase
    .from("link_preview_cache")
    .select("url, title, description, image, site_name, success, fetched_at")
    .eq("url", url)
    .single();

  if (error || !data) return null;
  if (!isFresh(data.fetched_at, data.success)) return null;
  return data;
};

const writeCache = async (url, preview, success) => {
  try {
    await supabase.from("link_preview_cache").upsert(
      {
        url,
        title: preview?.title || null,
        description: preview?.description || null,
        image: preview?.image || null,
        site_name: preview?.siteName || null,
        success,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "url" },
    );
  } catch (e) {
    console.error(`[linkPreview] cache write failed for ${url}:`, e.message);
  }
};

// Actual network scrape (no caching).
const fetchFromNetwork = async (url) => {
  try {
    const data = await getLinkPreview(url, {
      timeout: 5000,
      followRedirects: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; Rollmate/1.0; +https://rollmate.app)",
      },
    });

    const image = data.images?.[0] || data.favicons?.[0];
    return {
      url: data.url,
      title: data.title,
      description: data.description,
      // Drop dead/staging image hosts so the client never tries to load them.
      image: image && !isUnsafeImageHost(image) ? image : null,
      siteName: data.siteName,
    };
  } catch (error) {
    // Silently skip common network errors (DNS, timeout, connection refused, etc.)
    const skipCodes = [
      "ENOTFOUND",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
    ];
    const errorCode = error.code || error.cause?.code;

    if (
      skipCodes.includes(errorCode) ||
      error.message?.includes("fetch failed")
    ) {
      console.log(`Link preview skipped (unreachable): ${url}`);
    } else {
      console.error(`Error fetching link preview for ${url}:`, error.message);
    }
    return null;
  }
};

const cachedToPreview = (row) =>
  row.success
    ? {
        url: row.url,
        title: row.title,
        description: row.description,
        image: row.image,
        siteName: row.site_name,
      }
    : null;

// Cache-first link preview. Checks DB cache, de-dupes concurrent fetches,
// scrapes only on a miss, then stores the result.
const fetchLinkPreview = async (url) => {
  const cached = await readCache(url);
  if (cached) return cachedToPreview(cached);

  if (inFlight.has(url)) return inFlight.get(url);

  const promise = (async () => {
    const preview = await fetchFromNetwork(url);
    await writeCache(url, preview, !!preview);
    return preview;
  })().finally(() => inFlight.delete(url));

  inFlight.set(url, promise);
  return promise;
};

// Process text and generate preview for first non-YouTube URL
const generateLinkPreview = async (text) => {
  if (!text) return null;

  const urls = extractUrls(text);
  if (urls.length === 0) return null;

  // Find first non-YouTube URL
  const previewUrl = urls.find((url) => !isYouTubeUrl(url));
  if (!previewUrl) return null;

  return await fetchLinkPreview(previewUrl);
};

module.exports = {
  extractUrls,
  isYouTubeUrl,
  isUnsafeImageHost,
  fetchLinkPreview,
  generateLinkPreview,
};
