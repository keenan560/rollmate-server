const express = require("express");
const router = express.Router();
const path = require("path");
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { postImageUpload, postVideoUpload } = require("../middleware/upload");

// Get posts (Feed)
router.get("/posts", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 30;
    const offset = (page - 1) * limit;

    console.log(`Fetching posts - page: ${page}, limit: ${limit}`);

    const { data, error } = await supabase.rpc("get_posts_with_details", {
      p_limit: limit,
      p_offset: offset,
      p_current_user_id: currentUserId,
    });

    if (error) {
      console.error("Error fetching posts:", error);
      return res.status(500).json({
        error: "Failed to fetch posts",
        message: error.message,
      });
    }

    console.log(`Fetched ${data.length} posts`);
    res.json(data);
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

    console.log(`Found ${data.length} posts for user ${userId}`);
    res.json(data);
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

    const { data, error } = await supabase
      .from("posts")
      .insert({
        user_id: currentUserId,
        content: content.trim(),
        media_type: "none",
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
      },
    );

    if (fetchError) {
      console.error("Error fetching complete post:", fetchError);
      return res.json(data);
    }

    res.status(201).json(completePost[0] || data);
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

      const { data: completePost } = await supabase.rpc(
        "get_posts_with_details",
        {
          p_limit: 1,
          p_offset: 0,
          p_current_user_id: currentUserId,
        },
      );

      res.status(201).json(completePost[0] || data);
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
        `Creating post with ${req.files.length} images for user:`,
        currentUserId,
      );

      // Upload all images to Supabase storage
      const imageUrls = [];
      for (const file of req.files) {
        const fileExt = path.extname(file.originalname);
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

      const { data: completePost } = await supabase.rpc(
        "get_posts_with_details",
        {
          p_limit: 1,
          p_offset: 0,
          p_current_user_id: currentUserId,
        },
      );

      res.status(201).json(completePost[0] || data);
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
  postVideoUpload.single("video"),
  async (req, res) => {
    try {
      const currentUserId = req.user.uid;
      const { content } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Post content is required" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Video file is required" });
      }

      console.log("Creating video post for user:", currentUserId);

      const fileExt = path.extname(req.file.originalname);
      const fileName = `${currentUserId}_${Date.now()}${fileExt}`;
      const filePath = `${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("post-videos")
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
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
        .getPublicUrl(filePath);

      const videoUrl = urlData.publicUrl;

      const { data, error } = await supabase
        .from("posts")
        .insert({
          user_id: currentUserId,
          content: content.trim(),
          media_type: "video",
          media_url: videoUrl,
          video_thumbnail_url: null,
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

      const { data: completePost } = await supabase.rpc(
        "get_posts_with_details",
        {
          p_limit: 1,
          p_offset: 0,
          p_current_user_id: currentUserId,
        },
      );

      res.status(201).json(completePost[0] || data);
    } catch (error) {
      console.error("Error in /posts/video endpoint:", error);
      res.status(500).json({
        error: "Failed to create post with video",
        message: error.message,
      });
    }
  },
);

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

    const { data: completePost } = await supabase.rpc(
      "get_posts_with_details",
      {
        p_limit: 1,
        p_offset: 0,
        p_current_user_id: currentUserId,
      },
    );

    res.status(201).json(completePost[0] || data);
  } catch (error) {
    console.error("Error in /posts/youtube endpoint:", error);
    res.status(500).json({
      error: "Failed to create post with YouTube video",
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

    if (!data) {
      return res.status(404).json({ error: "Post not found or unauthorized" });
    }

    res.json({ success: true, message: "Post deleted successfully" });
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
