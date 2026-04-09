/**
 * Image optimization utilities for reducing bandwidth usage
 */

// Optimize image URL with Supabase transformations
function optimizeImageUrl(url, size = "medium") {
  // Return original URL — no server-side transformation
  // expo-image handles caching on the client
  return url;
}

// Optimize array of image URLs
function optimizeImageUrls(urls, size = "medium") {
  if (!Array.isArray(urls)) return urls;
  return urls.map((url) => optimizeImageUrl(url, size));
}

// Optimize post object with images
function optimizePostImages(post) {
  if (!post) return post;

  // Return post as-is, no image transformation
  // expo-image handles caching on the client
  return post;
}

// Optimize user object
function optimizeUserImages(user) {
  if (!user) return user;

  // Don't transform avatar_url — keep original quality
  return user;
}

module.exports = {
  optimizeImageUrl,
  optimizeImageUrls,
  optimizePostImages,
  optimizeUserImages,
};
