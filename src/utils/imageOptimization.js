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

  return {
    ...post,
    // Keep original URLs for full-screen viewing
    original_media_url: post.media_url || null,
    original_media_urls: post.media_urls || null,

    // Optimize main media
    media_url: post.media_url
      ? optimizeImageUrl(post.media_url, "medium")
      : null,

    // Optimize multiple images
    media_urls: post.media_urls
      ? optimizeImageUrls(post.media_urls, "medium")
      : null,

    // Optimize user avatar
    avatar_url: post.avatar_url
      ? optimizeImageUrl(post.avatar_url, "avatar")
      : null,

    // Optimize link preview image
    link_preview:
      post.link_preview && post.link_preview.image
        ? {
            ...post.link_preview,
            image: optimizeImageUrl(post.link_preview.image, "small"),
          }
        : post.link_preview,
  };
}

// Optimize user object
function optimizeUserImages(user) {
  if (!user) return user;

  return {
    ...user,
    avatar_url: user.avatar_url
      ? optimizeImageUrl(user.avatar_url, "avatar")
      : null,
  };
}

module.exports = {
  optimizeImageUrl,
  optimizeImageUrls,
  optimizePostImages,
  optimizeUserImages,
};
