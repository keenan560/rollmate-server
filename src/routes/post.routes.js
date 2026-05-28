const express = require("express");
const router = express.Router();
const path = require("path");
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { postImageUpload, postVideoUpload } = require("../middleware/upload");
const { generateLinkPreview } = require("../utils/linkPreview");
const { optimizePostImages } = require("../utils/imageOptimization");
const { sendNotification } = require("../services/notification");

// Get link preview
router.post("/posts/link-preview", verifyToken, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    console.log("Fetching link preview for:", url);

    const preview = await generateLinkPreview(url);

    if (!preview) {
      return res.status(404).json({ error: "Could not generate preview" });
    }

    res.json(preview);
  } catch (error) {
    console.error("Error in /posts/link-preview endpoint:", error);
    res.status(500).json({
      error: "Failed to fetch link preview",
      message: error.message,
    });
  }
});

// Get posts (Feed)
router.get("/posts", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 15, 30); // Reduced default from 30 to 15, max 30
    const offset = (page - 1) * limit;

    console.log(`Fetching posts - page: ${page}, limit: ${limit}`);
    const seventyTwoHoursAgo = new Date(
      Date.now() - 72 * 60 * 60 * 1000,
    ).toISOString();

    let { data, error } = await supabase.rpc("get_posts_with_details", {
      p_limit: limit,
      p_offset: offset,
      p_current_user_id: currentUserId,
      p_since: seventyTwoHoursAgo,
    });

    if (error) {
      console.error("Error fetching posts:", error);
      return res.status(500).json({
        error: "Failed to fetch posts",
        message: error.message,
      });
    }

    // Filter out posts from private users who aren't friends
    const postUserIds = [...new Set(data.map((p) => p.user_id))];
    const { data: privateUsers } = await supabase
      .from("users")
      .select("id")
      .in("id", postUserIds)
      .eq("is_private", true);

    if (privateUsers && privateUsers.length > 0) {
      const privateIds = new Set(privateUsers.map((u) => u.id));

      const { data: friendships } = await supabase
        .from("roll_requests")
        .select("sender_id, receiver_id")
        .eq("status", "accepted")
        .or(`sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`);

      const friendSet = new Set(
        (friendships || []).map((f) =>
          f.sender_id === currentUserId ? f.receiver_id : f.sender_id,
        ),
      );

      data = data.filter(
        (post) =>
          post.user_id === currentUserId ||
          friendSet.has(post.user_id) ||
          !privateIds.has(post.user_id),
      );
    }

    // Optimize images in all posts
    const optimizedPosts = data.map((post) => optimizePostImages(post));

    console.log(`Fetched ${optimizedPosts.length} posts (optimized)`);
    res.json(optimizedPosts);
  } catch (error) {
    console.error("Error in /posts endpoint:", error);
    res.status(500).json({
      error: "Failed to fetch posts",
      message: error.message,
    });
  }
});

// Get posts by user ID
router.get("/posts/user/:userId", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.uid;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = (page - 1) * limit;

    console.log(
      `Fetching posts for user ${userId} - page: ${page}, limit: ${limit}`,
    );

    // Use dedicated function for better performance
    const { data, error } = await supabase.rpc("get_user_posts_with_details", {
      p_user_id: userId,
      p_current_user_id: currentUserId,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      console.error("Error fetching user posts:", error);
      return res.status(500).json({
        error: "Failed to fetch user posts",
        message: error.message,
      });
    }

    // Optimize images in all posts
    const optimizedPosts = data.map((post) => optimizePostImages(post));

    console.log(
      `Found ${optimizedPosts.length} posts for user ${userId} (optimized)`,
    );
    res.json(optimizedPosts);
  } catch (error) {
    console.error("Error in /posts/user/:userId endpoint:", error);
    res.status(500).json({
      error: "Failed to fetch user posts",
      message: error.message,
    });
  }
});

// Create post (Text only)
router.post("/posts", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Post content is required" });
    }

    console.log("Creating text post for user:", currentUserId);

    // Generate link preview if content has URLs
    const linkPreview = await generateLinkPreview(content);

    const { data, error } = await supabase
      .from("posts")
      .insert({
        user_id: currentUserId,
        content: content.trim(),
        media_type: "none",
        link_preview: linkPreview, // Store as JSONB
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating post:", error);
      return res.status(500).json({
        error: "Failed to create post",
        message: error.message,
      });
    }

    const { data: completePost, error: fetchError } = await supabase.rpc(
      "get_posts_with_details",
      {
        p_limit: 1,
        p_offset: 0,
        p_current_user_id: currentUserId,
        p_since: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
      },
    );

    if (fetchError) {
      console.error("Error fetching complete post:", fetchError);
      return res.json(data);
    }

    res.status(201).json(completePost?.[0] || data);
  } catch (error) {
    console.error("Error in /posts POST endpoint:", error);
    res.status(500).json({
      error: "Failed to create post",
      message: error.message,
    });
  }
});

// Create post with image
router.post(
  "/posts/image",
  verifyToken,
  postImageUpload.single("image"),
  async (req, res) => {
    try {
      const currentUserId = req.user.uid;
      const { content } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Post content is required" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Image file is required" });
      }

      console.log("Creating image post for user:", currentUserId);

      const fileExt = path.extname(req.file.originalname);
      const fileName = `${currentUserId}_${Date.now()}${fileExt}`;
      const filePath = `${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("post-images")
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });

      if (uploadError) {
        console.error("Error uploading image:", uploadError);
        return res.status(500).json({
          error: "Failed to upload image",
          message: uploadError.message,
        });
      }

      const { data: urlData } = supabase.storage
        .from("post-images")
        .getPublicUrl(filePath);

      const imageUrl = urlData.publicUrl;

      const { data, error } = await supabase
        .from("posts")
        .insert({
          user_id: currentUserId,
          content: content.trim(),
          media_type: "image",
          media_url: imageUrl,
        })
        .select()
        .single();

      if (error) {
        console.error("Error creating post:", error);
        return res.status(500).json({
          error: "Failed to create post",
          message: error.message,
        });
      }

      const { data: completePost, error: rpcError } = await supabase.rpc(
        "get_posts_with_details",
        {
          p_limit: 1,
          p_offset: 0,
          p_current_user_id: currentUserId,
          p_since: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
        },
      );

      if (rpcError) {
        console.error("Error fetching complete post:", rpcError);
      }

      res.status(201).json(completePost?.[0] || data);
    } catch (error) {
      console.error("Error in /posts/image endpoint:", error);
      res.status(500).json({
        error: "Failed to create post with image",
        message: error.message,
      });
    }
  },
);

// Create post with multiple images
router.post(
  "/posts/images",
  verifyToken,
  postImageUpload.array("images", 10), // Allow up to 10 images
  async (req, res) => {
    try {
      const currentUserId = req.user.uid;
      const { content } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Post content is required" });
      }

      if (!req.files || req.files.length === 0) {
        return res
          .status(400)
          .json({ error: "At least one image is required" });
      }

      console.log(
        "Files received:",
        req.files.map((f) => ({
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
          fieldname: f.fieldname,
        })),
      );

      console.log(
        `Creating post with ${req.files.length} images for user:`,
        currentUserId,
      );

      // Upload all images to Supabase storage
      const imageUrls = [];
      for (const file of req.files) {
        // originalname can be null from React Native FormData
        const originalName = file.originalname || file.fieldname || "image.jpg";
        const fileExt = path.extname(originalName) || ".jpg";
        const fileName = `${currentUserId}_${Date.now()}_${Math.random().toString(36).substring(7)}${fileExt}`;
        const filePath = `${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("post-images")
          .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false,
          });

        if (uploadError) {
          console.error("Error uploading image:", uploadError);
          // Clean up already uploaded images
          for (const url of imageUrls) {
            const path = url.split("/post-images/")[1];
            await supabase.storage.from("post-images").remove([path]);
          }
          return res.status(500).json({
            error: "Failed to upload images",
            message: uploadError.message,
          });
        }

        const { data: urlData } = supabase.storage
          .from("post-images")
          .getPublicUrl(filePath);

        imageUrls.push(urlData.publicUrl);
      }

      // Create the post with first image as primary
      const { data, error } = await supabase
        .from("posts")
        .insert({
          user_id: currentUserId,
          content: content.trim(),
          media_type: "image",
          media_url: imageUrls[0], // Primary image
          media_urls: imageUrls, // Array of all images
        })
        .select()
        .single();

      if (error) {
        console.error("Error creating post:", error);
        // Clean up uploaded images
        for (const url of imageUrls) {
          const path = url.split("/post-images/")[1];
          await supabase.storage.from("post-images").remove([path]);
        }
        return res.status(500).json({
          error: "Failed to create post",
          message: error.message,
        });
      }

      const { data: completePost, error: rpcError } = await supabase.rpc(
        "get_posts_with_details",
        {
          p_limit: 1,
          p_offset: 0,
          p_current_user_id: currentUserId,
          p_since: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
        },
      );

      if (rpcError) {
        console.error("Error fetching complete post:", rpcError);
      }

      res.status(201).json(completePost?.[0] || data);
    } catch (error) {
      console.error("Error in /posts/images endpoint:", error);
      res.status(500).json({
        error: "Failed to create post with images",
        message: error.message,
      });
    }
  },
);

// Create post with video
router.post(
  "/posts/video",
  verifyToken,
  postVideoUpload.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const currentUserId = req.user.uid;
      const { content } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Post content is required" });
      }

      if (!req.files || !req.files.video) {
        return res.status(400).json({ error: "Video file is required" });
      }

      console.log("Creating video post for user:", currentUserId);

      const videoFile = req.files.video[0];
      const thumbnailFile = req.files.thumbnail ? req.files.thumbnail[0] : null;

      // Upload video
      const videoExt = path.extname(videoFile.originalname);
      const videoFileName = `${currentUserId}_${Date.now()}${videoExt}`;
      const videoFilePath = `${videoFileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("post-videos")
        .upload(videoFilePath, videoFile.buffer, {
          contentType: videoFile.mimetype,
          upsert: false,
        });

      if (uploadError) {
        console.error("Error uploading video:", uploadError);
        return res.status(500).json({
          error: "Failed to upload video",
          message: uploadError.message,
        });
      }

      const { data: urlData } = supabase.storage
        .from("post-videos")
        .getPublicUrl(videoFilePath);

      const videoUrl = urlData.publicUrl;

      // Upload thumbnail if provided
      let thumbnailUrl = null;
      if (thumbnailFile) {
        console.log("Uploading video thumbnail for user:", currentUserId);

        const thumbnailFileName = `thumb_${currentUserId}_${Date.now()}.jpg`;
        const thumbnailFilePath = `${thumbnailFileName}`;

        const { data: thumbUploadData, error: thumbUploadError } =
          await supabase.storage
            .from("video-thumbnails")
            .upload(thumbnailFilePath, thumbnailFile.buffer, {
              contentType: "image/jpeg",
              upsert: false,
            });

        if (thumbUploadError) {
          console.error("Error uploading thumbnail:", thumbUploadError);
          // Continue without thumbnail - not critical
        } else {
          const { data: thumbUrlData } = supabase.storage
            .from("video-thumbnails")
            .getPublicUrl(thumbnailFilePath);

          thumbnailUrl = thumbUrlData.publicUrl;
          console.log("Thumbnail uploaded successfully:", thumbnailUrl);
        }
      }

      // Create post with video and thumbnail
      const { data, error } = await supabase
        .from("posts")
        .insert({
          user_id: currentUserId,
          content: content.trim(),
          media_type: "video",
          media_url: videoUrl,
          video_thumbnail_url: thumbnailUrl,
        })
        .select()
        .single();

      if (error) {
        console.error("Error creating post:", error);
        return res.status(500).json({
          error: "Failed to create post",
          message: error.message,
        });
      }

      const { data: completePost, error: rpcError } = await supabase.rpc(
        "get_posts_with_details",
        {
          p_limit: 1,
          p_offset: 0,
          p_current_user_id: currentUserId,
          p_since: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
        },
      );

      if (rpcError) {
        console.error("Error fetching complete post:", rpcError);
      }

      res.status(201).json(completePost?.[0] || data);
    } catch (error) {
      console.error("Error in /posts/video endpoint:", error);
      res.status(500).json({
        error: "Failed to create post with video",
        message: error.message,
      });
    }
  },
);

// Generate signed upload URLs for direct-to-Supabase video upload
router.post("/posts/video/signed-url", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { videoExtension, videoContentType, hasThumbnail } = req.body;
    const timestamp = Date.now();

    console.log(
      `[Video Signed URL] User: ${userId}, ext: ${videoExtension}, contentType: ${videoContentType}, hasThumbnail: ${hasThumbnail}`,
    );

    // Generate signed URL for video
    const videoPath = `video_${userId}_${timestamp}.${videoExtension}`;
    const { data: videoData, error: videoError } = await supabase.storage
      .from("post-videos")
      .createSignedUploadUrl(videoPath);

    if (videoError) {
      console.error(
        `[Video Signed URL] Failed to create video signed URL:`,
        videoError,
      );
      throw videoError;
    }

    console.log(
      `[Video Signed URL] Video signed URL created for path: ${videoPath}`,
    );

    let thumbnailUploadUrl = null;
    let thumbnailToken = null;
    let thumbnailPath = null;

    // Generate signed URL for thumbnail if needed
    if (hasThumbnail) {
      thumbnailPath = `thumb_${userId}_${timestamp}.jpg`;
      const { data: thumbData, error: thumbError } = await supabase.storage
        .from("video-thumbnails")
        .createSignedUploadUrl(thumbnailPath);

      if (thumbError) {
        console.error(
          `[Video Signed URL] Failed to create thumbnail signed URL:`,
          thumbError,
        );
      } else {
        thumbnailUploadUrl = thumbData.signedUrl;
        thumbnailToken = thumbData.token;
        console.log(
          `[Video Signed URL] Thumbnail signed URL created for path: ${thumbnailPath}`,
        );
      }
    }

    console.log(`[Video Signed URL] Success - returning signed URLs to client`);
    res.json({
      videoUploadUrl: videoData.signedUrl,
      videoToken: videoData.token,
      videoPath,
      thumbnailUploadUrl,
      thumbnailToken,
      thumbnailPath,
    });
  } catch (error) {
    console.error("[Video Signed URL] Error:", error);
    res.status(500).json({ message: "Failed to generate upload URLs" });
  }
});

// Create post record after direct-to-Supabase video upload
router.post("/posts/video/complete", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { content, videoPath, thumbnailPath } = req.body;

    console.log(
      `[Video Complete] User: ${userId}, videoPath: ${videoPath}, thumbnailPath: ${thumbnailPath}`,
    );
    console.log(
      `[Video Complete] Content: "${content?.substring(0, 50)}${content?.length > 50 ? "..." : ""}"`,
    );

    // Get public URLs
    const { data: videoUrlData } = supabase.storage
      .from("post-videos")
      .getPublicUrl(videoPath);

    console.log(`[Video Complete] Video public URL: ${videoUrlData.publicUrl}`);

    let thumbnailUrl = null;
    if (thumbnailPath) {
      const { data: thumbUrlData } = supabase.storage
        .from("video-thumbnails")
        .getPublicUrl(thumbnailPath);
      thumbnailUrl = thumbUrlData.publicUrl;
      console.log(`[Video Complete] Thumbnail public URL: ${thumbnailUrl}`);
    }

    // Insert post record
    const { data: post, error } = await supabase
      .from("posts")
      .insert({
        user_id: userId,
        content,
        media_type: "video",
        media_url: videoUrlData.publicUrl,
        video_thumbnail_url: thumbnailUrl,
      })
      .select()
      .single();

    if (error) {
      console.error(`[Video Complete] Failed to insert post:`, error);
      throw error;
    }

    console.log(`[Video Complete] Post created with id: ${post.id}`);

    // Fetch enriched post data
    const { data: completePost, error: rpcError } = await supabase.rpc(
      "get_posts_with_details",
      {
        p_limit: 1,
        p_offset: 0,
        p_current_user_id: userId,
        p_since: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
      },
    );

    if (rpcError) {
      console.error("[Video Complete] Error fetching enriched post:", rpcError);
    }

    console.log(`[Video Complete] Success - returning post ${post.id}`);
    res.status(201).json(completePost?.[0] || post);
  } catch (error) {
    console.error("[Video Complete] Error:", error);
    res.status(500).json({ message: "Failed to create video post" });
  }
});

// Create post with YouTube video
router.post("/posts/youtube", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { content, videoUrl } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Post content is required" });
    }

    if (!videoUrl) {
      return res.status(400).json({ error: "YouTube video URL is required" });
    }

    const youtubeUrlPattern =
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    if (!youtubeUrlPattern.test(videoUrl)) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    console.log("Creating YouTube video post for user:", currentUserId);

    const { data, error } = await supabase
      .from("posts")
      .insert({
        user_id: currentUserId,
        content: content.trim(),
        media_type: "video",
        media_url: videoUrl,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating post:", error);
      return res.status(500).json({
        error: "Failed to create post",
        message: error.message,
      });
    }

    const { data: completePost, error: rpcError } = await supabase.rpc(
      "get_posts_with_details",
      {
        p_limit: 1,
        p_offset: 0,
        p_current_user_id: currentUserId,
        p_since: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
      },
    );

    if (rpcError) {
      console.error("Error fetching complete post:", rpcError);
    }

    res.status(201).json(completePost?.[0] || data);
  } catch (error) {
    console.error("Error in /posts/youtube endpoint:", error);
    res.status(500).json({
      error: "Failed to create post with YouTube video",
      message: error.message,
    });
  }
});

// Search posts (no 72h window)
router.get("/posts/search", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const query = req.query.q;

    if (!query || !query.trim()) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const searchTerm = `%${query.trim()}%`;

    const { data, error } = await supabase.rpc("search_posts_with_details", {
      p_search_term: searchTerm,
      p_current_user_id: currentUserId,
      p_limit: 30,
    });

    if (error) {
      console.error("Error searching posts:", error);
      return res.status(500).json({
        error: "Failed to search posts",
        message: error.message,
      });
    }

    const optimizedPosts = data.map((post) => optimizePostImages(post));
    res.json(optimizedPosts);
  } catch (error) {
    console.error("Error in /posts/search endpoint:", error);
    res.status(500).json({
      error: "Failed to search posts",
      message: error.message,
    });
  }
});

// ============================================
// GET SINGLE POST BY ID
// ============================================
router.get("/posts/:postId", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { postId } = req.params;

    if (!postId) {
      return res.status(400).json({ error: "Post ID is required" });
    }

    console.log("Fetching post:", postId, "for user:", currentUserId);

    // Try the dedicated single post function first
    const { data: singlePostData, error: singlePostError } = await supabase.rpc(
      "get_single_post_with_details",
      {
        p_post_id: postId,
        p_current_user_id: currentUserId,
      },
    );

    if (!singlePostError && singlePostData && singlePostData.length > 0) {
      const optimizedPost = optimizePostImages(singlePostData[0]);
      return res.json(optimizedPost);
    }

    // Log why the RPC failed so you can debug
    if (singlePostError) {
      console.error("get_single_post_with_details error:", singlePostError);
    }

    // Fallback: fetch directly from posts table (no time filter, no feed restriction)
    const { data: post, error: postError } = await supabase
      .from("posts")
      .select(
        `
        *,
        users:user_id (
          id,
          first_name,
          last_name,
          avatar_url,
          belt
        )
      `,
      )
      .eq("id", postId)
      .eq("is_deleted", false)
      .single();

    if (postError || !post) {
      console.error("Post not found:", postError);
      return res.status(404).json({ error: "Post not found" });
    }

    // Get like count and whether current user liked it
    const { count: likeCount } = await supabase
      .from("post_likes")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId);

    const { data: userLike } = await supabase
      .from("post_likes")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", currentUserId)
      .single();

    // Shape response to match what frontend expects
    const shaped = {
      ...post,
      user_first_name: post.users?.first_name,
      user_last_name: post.users?.last_name,
      user_avatar_url: post.users?.avatar_url,
      user_belt: post.users?.belt,
      like_count: likeCount || 0,
      is_liked_by_current_user: !!userLike,
    };

    const optimizedPost = optimizePostImages(shaped);
    res.json(optimizedPost);
  } catch (error) {
    console.error("Error in /posts/:postId GET endpoint:", error);
    res.status(500).json({
      error: "Failed to fetch post",
      message: error.message,
    });
  }
});

// Like post
router.post("/posts/:postId/like", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { postId } = req.params;

    console.log(`User ${currentUserId} liking post ${postId}`);

    const { data: existingLike } = await supabase
      .from("post_likes")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", currentUserId)
      .single();

    if (existingLike) {
      return res.status(400).json({ error: "Post already liked" });
    }

    const { data, error } = await supabase
      .from("post_likes")
      .insert({
        post_id: postId,
        user_id: currentUserId,
      })
      .select()
      .single();

    if (error) {
      console.error("Error liking post:", error);
      return res.status(500).json({
        error: "Failed to like post",
        message: error.message,
      });
    }

    const { count } = await supabase
      .from("post_likes")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId);

    res.json({ success: true, likes_count: count });

    // Send push notification to post author (fire and forget)
    try {
      const { data: post } = await supabase
        .from("posts")
        .select("user_id")
        .eq("id", postId)
        .single();

      if (post && post.user_id !== currentUserId) {
        const { data: liker } = await supabase
          .from("users")
          .select("first_name, last_name")
          .eq("id", currentUserId)
          .single();

        if (liker) {
          sendNotification(
            post.user_id,
            `${liker.first_name} ${liker.last_name} liked your post`,
            {
              title: "New Like ❤️",
              data: {
                type: "like",
                post_id: String(postId),
                user_id: currentUserId,
                user_name: `${liker.first_name} ${liker.last_name}`,
              },
            },
          ).catch((err) => console.error("Like push error:", err));
        }
      }
    } catch (pushErr) {
      console.error("Error sending like push:", pushErr);
    }
  } catch (error) {
    console.error("Error in /posts/:postId/like endpoint:", error);
    res.status(500).json({
      error: "Failed to like post",
      message: error.message,
    });
  }
});

// Unlike post
router.delete("/posts/:postId/like", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { postId } = req.params;

    console.log(`User ${currentUserId} unliking post ${postId}`);

    const { error } = await supabase
      .from("post_likes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", currentUserId);

    if (error) {
      console.error("Error unliking post:", error);
      return res.status(500).json({
        error: "Failed to unlike post",
        message: error.message,
      });
    }

    const { count } = await supabase
      .from("post_likes")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId);

    res.json({ success: true, likes_count: count });
  } catch (error) {
    console.error("Error in /posts/:postId/like DELETE endpoint:", error);
    res.status(500).json({
      error: "Failed to unlike post",
      message: error.message,
    });
  }
});

// Get comments for post
router.get("/posts/:postId/comments", verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = (page - 1) * limit;

    console.log(`Fetching comments for post ${postId}`);

    const { data, error } = await supabase.rpc("get_post_comments", {
      p_post_id: postId,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      console.error("Error fetching comments:", error);
      return res.status(500).json({
        error: "Failed to fetch comments",
        message: error.message,
      });
    }

    res.json(data);
  } catch (error) {
    console.error("Error in /posts/:postId/comments endpoint:", error);
    res.status(500).json({
      error: "Failed to fetch comments",
      message: error.message,
    });
  }
});

// Add comment to post
router.post("/posts/:postId/comments", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { postId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Comment content is required" });
    }

    console.log(`User ${currentUserId} commenting on post ${postId}`);

    const { data, error } = await supabase
      .from("post_comments")
      .insert({
        post_id: postId,
        user_id: currentUserId,
        content: content.trim(),
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating comment:", error);
      return res.status(500).json({
        error: "Failed to create comment",
        message: error.message,
      });
    }

    const { data: completeComment } = await supabase.rpc("get_post_comments", {
      p_post_id: postId,
      p_limit: 1,
      p_offset: 0,
    });

    res.status(201).json(completeComment[0] || data);

    // Send push notification to post author (fire and forget)
    try {
      const { data: post } = await supabase
        .from("posts")
        .select("user_id")
        .eq("id", postId)
        .single();

      if (post && post.user_id !== currentUserId) {
        const { data: commenter } = await supabase
          .from("users")
          .select("first_name, last_name")
          .eq("id", currentUserId)
          .single();

        if (commenter) {
          const preview =
            content.trim().length > 50
              ? content.trim().substring(0, 50) + "..."
              : content.trim();

          sendNotification(
            post.user_id,
            `${commenter.first_name} ${commenter.last_name} commented: "${preview}"`,
            {
              title: "New Comment 💬",
              data: {
                type: "comment",
                post_id: String(postId),
                user_id: currentUserId,
                user_name: `${commenter.first_name} ${commenter.last_name}`,
              },
            },
          ).catch((err) => console.error("Comment push error:", err));
        }
      }
    } catch (pushErr) {
      console.error("Error sending comment push:", pushErr);
    }
  } catch (error) {
    console.error("Error in /posts/:postId/comments POST endpoint:", error);
    res.status(500).json({
      error: "Failed to create comment",
      message: error.message,
    });
  }
});

// Update/Edit post
router.put("/posts/:postId", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { postId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Post content is required" });
    }

    console.log(`User ${currentUserId} editing post ${postId}`);

    // Update the post (only allow editing own posts)
    const { data, error } = await supabase
      .from("posts")
      .update({
        content: content.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId)
      .eq("user_id", currentUserId)
      .select()
      .single();

    if (error) {
      console.error("Error updating post:", error);
      return res.status(500).json({
        error: "Failed to update post",
        message: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({ error: "Post not found or unauthorized" });
    }

    // Fetch complete post with details using dedicated function
    const { data: completePostArray } = await supabase.rpc(
      "get_single_post_with_details",
      {
        p_post_id: postId,
        p_current_user_id: currentUserId,
      },
    );

    const completePost = completePostArray?.[0];

    res.json(completePost || data);
  } catch (error) {
    console.error("Error in /posts/:postId PUT endpoint:", error);
    res.status(500).json({
      error: "Failed to update post",
      message: error.message,
    });
  }
});

// Delete post
router.delete("/posts/:postId", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { postId } = req.params;

    console.log(`User ${currentUserId} deleting post ${postId}`);

    // First, fetch the post to get media URLs
    const { data: post, error: fetchError } = await supabase
      .from("posts")
      .select("media_url, media_urls, media_type, video_thumbnail_url, user_id")
      .eq("id", postId)
      .eq("user_id", currentUserId)
      .single();

    if (fetchError || !post) {
      return res.status(404).json({ error: "Post not found or unauthorized" });
    }

    // Collect media files to delete
    const mediaFilesToDelete = [];

    if (post.media_url) {
      if (
        post.media_type === "image" &&
        post.media_url.includes("/post-images/")
      ) {
        const filePath = post.media_url.split("/post-images/")[1];
        mediaFilesToDelete.push({ bucket: "post-images", path: filePath });
      } else if (
        post.media_type === "video" &&
        post.media_url.includes("/post-videos/")
      ) {
        const filePath = post.media_url.split("/post-videos/")[1];
        mediaFilesToDelete.push({ bucket: "post-videos", path: filePath });
      }
    }

    // Handle multiple images
    if (post.media_urls && Array.isArray(post.media_urls)) {
      for (const url of post.media_urls) {
        if (url.includes("/post-images/")) {
          const filePath = url.split("/post-images/")[1];
          mediaFilesToDelete.push({ bucket: "post-images", path: filePath });
        }
      }
    }

    // Handle video thumbnail
    if (
      post.video_thumbnail_url &&
      post.video_thumbnail_url.includes("/video-thumbnails/")
    ) {
      const filePath = post.video_thumbnail_url.split("/video-thumbnails/")[1];
      mediaFilesToDelete.push({ bucket: "video-thumbnails", path: filePath });
    }

    // Soft delete the post
    const { data, error } = await supabase
      .from("posts")
      .update({ is_deleted: true })
      .eq("id", postId)
      .eq("user_id", currentUserId)
      .select()
      .single();

    if (error) {
      console.error("Error deleting post:", error);
      return res.status(500).json({
        error: "Failed to delete post",
        message: error.message,
      });
    }

    // Delete media files from storage
    let deletedFilesCount = 0;
    for (const file of mediaFilesToDelete) {
      try {
        const { error: storageError } = await supabase.storage
          .from(file.bucket)
          .remove([file.path]);

        if (!storageError) {
          deletedFilesCount++;
        } else {
          console.error(
            `Failed to delete ${file.bucket}/${file.path}:`,
            storageError.message,
          );
        }
      } catch (storageErr) {
        console.error(
          `Error deleting file ${file.bucket}/${file.path}:`,
          storageErr,
        );
      }
    }

    console.log(`Deleted ${deletedFilesCount} media files from storage`);

    res.json({
      success: true,
      message: "Post deleted successfully",
      deletedMediaFiles: deletedFilesCount,
    });
  } catch (error) {
    console.error("Error in /posts/:postId DELETE endpoint:", error);
    res.status(500).json({
      error: "Failed to delete post",
      message: error.message,
    });
  }
});

// Report post
router.post("/posts/report", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { post_id, reason } = req.body;

    if (!post_id || !reason) {
      return res.status(400).json({ error: "Post ID and reason are required" });
    }

    console.log(
      `User ${currentUserId} reporting post ${post_id} for ${reason}`,
    );

    // Insert report into database
    const { data, error } = await supabase
      .from("post_reports")
      .insert({
        post_id: post_id,
        reported_by: currentUserId,
        reason: reason,
      })
      .select()
      .single();

    if (error) {
      // If already reported, that's fine
      if (error.code === "23505") {
        // Unique constraint violation
        return res.json({ success: true, message: "Post already reported" });
      }
      console.error("Error reporting post:", error);
      return res.status(500).json({
        error: "Failed to report post",
        message: error.message,
      });
    }

    res.json({ success: true, message: "Post reported successfully" });
  } catch (error) {
    console.error("Error in /posts/report endpoint:", error);
    res.status(500).json({
      error: "Failed to report post",
      message: error.message,
    });
  }
});

// Hide post
router.post("/posts/hide", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { post_id } = req.body;

    if (!post_id) {
      return res.status(400).json({ error: "Post ID is required" });
    }

    console.log(`User ${currentUserId} hiding post ${post_id}`);

    // Insert hidden post record
    const { data, error } = await supabase
      .from("hidden_posts")
      .insert({
        post_id: post_id,
        user_id: currentUserId,
      })
      .select()
      .single();

    if (error) {
      // If already hidden, that's fine
      if (error.code === "23505") {
        // Unique constraint violation
        return res.json({ success: true, message: "Post already hidden" });
      }
      console.error("Error hiding post:", error);
      return res.status(500).json({
        error: "Failed to hide post",
        message: error.message,
      });
    }

    res.json({ success: true, message: "Post hidden successfully" });
  } catch (error) {
    console.error("Error in /posts/hide endpoint:", error);
    res.status(500).json({
      error: "Failed to hide post",
      message: error.message,
    });
  }
});

// Unhide post
router.post("/posts/unhide", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const { post_id } = req.body;

    if (!post_id) {
      return res.status(400).json({ error: "Post ID is required" });
    }

    console.log(`User ${currentUserId} unhiding post ${post_id}`);

    // Delete the hidden post record
    const { error } = await supabase
      .from("hidden_posts")
      .delete()
      .eq("post_id", post_id)
      .eq("user_id", currentUserId);

    if (error) {
      console.error("Error unhiding post:", error);
      return res.status(500).json({
        error: "Failed to unhide post",
        message: error.message,
      });
    }

    res.json({ success: true, message: "Post restored successfully" });
  } catch (error) {
    console.error("Error in /posts/unhide endpoint:", error);
    res.status(500).json({
      error: "Failed to unhide post",
      message: error.message,
    });
  }
});

// Like a specific photo in a multi-image post
router.post(
  "/posts/:postId/photos/:photoIndex/like",
  verifyToken,
  async (req, res) => {
    try {
      const { postId, photoIndex } = req.params;
      const currentUserId = req.user.uid;

      // Validate photo index
      const photoIndexNum = parseInt(photoIndex, 10);
      if (isNaN(photoIndexNum) || photoIndexNum < 0) {
        return res.status(400).json({ error: "Invalid photo index" });
      }

      console.log(
        `User ${currentUserId} liking photo ${photoIndexNum} in post ${postId}`,
      );

      // Check if post exists and has photos
      const { data: post, error: postError } = await supabase
        .from("posts")
        .select("media_urls")
        .eq("id", postId)
        .single();

      if (postError || !post) {
        return res.status(404).json({ error: "Post not found" });
      }

      if (!post.media_urls || photoIndexNum >= post.media_urls.length) {
        return res.status(400).json({ error: "Photo index out of range" });
      }

      // Insert like
      const { data, error } = await supabase
        .from("photo_likes")
        .insert({
          post_id: postId,
          photo_index: photoIndexNum,
          user_id: currentUserId,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          // Already liked
          return res.status(400).json({ error: "Photo already liked" });
        }
        console.error("Error liking photo:", error);
        return res.status(500).json({
          error: "Failed to like photo",
          message: error.message,
        });
      }

      // Get updated like count
      const { data: likeData } = await supabase.rpc(
        "get_photo_likes_for_post",
        {
          p_post_id: postId,
          p_user_id: currentUserId,
        },
      );

      const photoLikes = likeData?.find((l) => l.photo_index === photoIndexNum);

      res.json({
        success: true,
        photo_index: photoIndexNum,
        likes_count: photoLikes?.likes_count || 1,
        is_liked_by_user: true,
      });
    } catch (error) {
      console.error("Error in /posts/:postId/photos/:photoIndex/like:", error);
      res.status(500).json({
        error: "Failed to like photo",
        message: error.message,
      });
    }
  },
);

// Unlike a specific photo in a multi-image post
router.delete(
  "/posts/:postId/photos/:photoIndex/like",
  verifyToken,
  async (req, res) => {
    try {
      const { postId, photoIndex } = req.params;
      const currentUserId = req.user.uid;

      const photoIndexNum = parseInt(photoIndex, 10);
      if (isNaN(photoIndexNum) || photoIndexNum < 0) {
        return res.status(400).json({ error: "Invalid photo index" });
      }

      console.log(
        `User ${currentUserId} unliking photo ${photoIndexNum} in post ${postId}`,
      );

      // Delete like
      const { error } = await supabase
        .from("photo_likes")
        .delete()
        .eq("post_id", postId)
        .eq("photo_index", photoIndexNum)
        .eq("user_id", currentUserId);

      if (error) {
        console.error("Error unliking photo:", error);
        return res.status(500).json({
          error: "Failed to unlike photo",
          message: error.message,
        });
      }

      // Get updated like count
      const { data: likeData } = await supabase.rpc(
        "get_photo_likes_for_post",
        {
          p_post_id: postId,
          p_user_id: currentUserId,
        },
      );

      const photoLikes = likeData?.find((l) => l.photo_index === photoIndexNum);

      res.json({
        success: true,
        photo_index: photoIndexNum,
        likes_count: photoLikes?.likes_count || 0,
        is_liked_by_user: false,
      });
    } catch (error) {
      console.error(
        "Error in /posts/:postId/photos/:photoIndex/like DELETE:",
        error,
      );
      res.status(500).json({
        error: "Failed to unlike photo",
        message: error.message,
      });
    }
  },
);

// Get photo likes for a post
router.get("/posts/:postId/photos/likes", verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const currentUserId = req.user.uid;

    console.log(`Fetching photo likes for post ${postId}`);

    const { data, error } = await supabase.rpc("get_photo_likes_for_post", {
      p_post_id: postId,
      p_user_id: currentUserId,
    });

    if (error) {
      console.error("Error fetching photo likes:", error);
      return res.status(500).json({
        error: "Failed to fetch photo likes",
        message: error.message,
      });
    }

    res.json(data || []);
  } catch (error) {
    console.error("Error in /posts/:postId/photos/likes:", error);
    res.status(500).json({
      error: "Failed to fetch photo likes",
      message: error.message,
    });
  }
});

module.exports = router;
