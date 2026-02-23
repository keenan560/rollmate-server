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

module.exports = router;
