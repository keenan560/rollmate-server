const { getLinkPreview } = require("link-preview-js");

// Extract URLs from text
const extractUrls = (text) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.match(urlRegex) || [];
};

// Check if URL is YouTube
const isYouTubeUrl = (url) => {
  return /(?:youtube\.com\/watch\?v=|youtu\.be\/)/.test(url);
};

// Fetch link preview with error handling
const fetchLinkPreview = async (url) => {
  try {
    const data = await getLinkPreview(url, {
      timeout: 5000,
      followRedirects: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; Rollmate/1.0; +https://rollmate.app)",
      },
    });

    return {
      url: data.url,
      title: data.title,
      description: data.description,
      image: data.images?.[0] || data.favicons?.[0],
      siteName: data.siteName,
    };
  } catch (error) {
    console.error("Error fetching link preview:", error);
    return null;
  }
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
  fetchLinkPreview,
  generateLinkPreview,
};
