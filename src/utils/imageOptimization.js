/**
 * Image optimization utilities for reducing bandwidth usage
 */

// Optimize image URL with Supabase transformations
function optimizeImageUrl(url, size = "medium") {
  if (!url || typeof url !== "string") return url;

  // Skip if already has transformations
  if (url.includes("?width=") || url.includes("&width=")) return url;

  // Size presets
  const sizes = {
    thumbnail: { width: 200, quality: 70 },
    small: { width: 400, quality: 75 },
    medium: { width: 800, quality: 75 },
    large: { width: 1200, quality: 80 },
    avatar: { width: 100, height: 100, quality: 70 },
  };

  const preset = sizes[size] || sizes.medium;

  // Build transformation params
  const params = new URLSearchParams();
  params.append("width", preset.width);
  if (preset.height) params.append("height", preset.height);
  params.append("quality", preset.quality);

  // Add params to URL
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${params.toString()}`;
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
