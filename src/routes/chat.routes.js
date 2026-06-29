const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const r2 = require("../services/r2Storage");
const { verifyToken } = require("../middleware/auth");
const { chatImageUpload } = require("../middleware/upload");
const { generateLinkPreview } = require("../utils/linkPreview");
const {
  optimizeImageUrl,
  optimizeUserImages,
} = require("../utils/imageOptimization");
const { sendNotification } = require("../services/notification");
const moderation = require("../services/moderation");

// Get link preview for chat
router.post("/chat/link-preview", verifyToken, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    console.log("Fetching chat link preview for:", url);

    const preview = await generateLinkPreview(url);

    if (!preview) {
      return res.status(404).json({ error: "Could not generate preview" });
    }

    res.json(preview);
  } catch (error) {
    console.error("Error in /chat/link-preview endpoint:", error);
    res.status(500).json({
      error: "Failed to fetch link preview",
      message: error.message,
    });
  }
});

// Send chat message with multiple images (up to 5)
router.post(
  "/chat-messages",
  verifyToken,
  chatImageUpload.array("images", 5), // Accept up to 5 images
  async (req, res) => {
    try {
      const rollRequestId = parseInt(req.body.chatId, 10);
      const message = req.body.message || "";
      const imageFiles = req.files; // Array of files
      const replyToId = req.body.reply_to_id
        ? parseInt(req.body.reply_to_id, 10)
        : null;

      console.log("Received message request body:", {
        chatId: req.body.chatId,
        message: req.body.message,
        reply_to_id: req.body.reply_to_id,
        parsedReplyToId: replyToId,
        allBodyKeys: Object.keys(req.body),
      });

      if (isNaN(rollRequestId)) {
        return res.status(400).json({ error: "Invalid chat ID" });
      }

      console.log("Received message:", {
        rollRequestId,
        messageLength: message.length,
        imageCount: imageFiles ? imageFiles.length : 0,
        replyToId,
      });

      // Get the roll request to find the users involved
      const { data: rollRequest, error: rollError } = await supabase
        .from("roll_requests")
        .select("sender_id, receiver_id, status")
        .eq("id", rollRequestId)
        .single();

      if (rollError) {
        console.error("Error fetching roll request:", rollError);
        return res.status(404).json({ error: "Roll request not found" });
      }

      // Only allow chat if request is accepted
      if (rollRequest.status !== "accepted") {
        return res
          .status(403)
          .json({ error: "Roll request must be accepted to chat" });
      }

      const user1 = rollRequest.sender_id;
      const user2 = rollRequest.receiver_id;

      console.log(
        `Looking for chat between users: ${user1} and ${user2} (from roll_request ${rollRequestId})`,
      );

      // ALWAYS check for ANY existing chat between these two users first
      // Find all accepted roll requests between these two users
      const { data: allFriendships, error: friendshipError } = await supabase
        .from("roll_requests")
        .select("id")
        .eq("status", "accepted")
        .or(
          `and(sender_id.eq.${user1},receiver_id.eq.${user2}),and(sender_id.eq.${user2},receiver_id.eq.${user1})`,
        )
        .order("created_at", { ascending: true }); // Get oldest first

      let chatData = null;

      if (!friendshipError && allFriendships && allFriendships.length > 0) {
        console.log(
          `Found ${allFriendships.length} accepted roll requests between these users`,
        );
        // Check if any of these friendships have a chat
        for (const friendship of allFriendships) {
          const { data: existingChat, error: existingChatError } =
            await supabase
              .from("chats")
              .select("id, roll_request_id")
              .eq("roll_request_id", friendship.id)
              .single();

          if (existingChat && !existingChatError) {
            console.log(
              `Found existing chat ${existingChat.id} from roll request ${friendship.id}`,
            );
            chatData = existingChat;
            break;
          }
        }
      }

      // If still no chat found, create a new one
      if (!chatData) {
        console.log(
          "No existing chat found, creating new chat for roll request:",
          rollRequestId,
        );
        const { data: newChat, error: createError } = await supabase
          .from("chats")
          .insert({
            roll_request_id: rollRequestId,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (createError) throw createError;
        chatData = newChat;
      }

      console.log("Using chat for message:", chatData);

      // Remove deleted_chats record for the sender so the conversation reappears
      await supabase
        .from("deleted_chats")
        .delete()
        .eq("chat_id", chatData.id)
        .eq("user_id", req.user.uid);

      // Content moderation before persisting message or uploading images.
      if (message && message.trim()) {
        const textMod = await moderation.checkText({
          text: message,
          surface: "chat_text",
          userId: req.user.uid,
        });
        if (!textMod.allowed) {
          return res.status(422).json({
            error: "Message rejected",
            code: "MODERATION_BLOCKED_TEXT",
            details: "This message violates our content policy.",
          });
        }
      }
      if (imageFiles && imageFiles.length > 0) {
        const imgMod = await moderation.checkImages({
          buffers: imageFiles.map((f) => f.buffer),
          surface: "chat_image",
          userId: req.user.uid,
        });
        if (!imgMod.allowed) {
          return res.status(422).json({
            error: "Image rejected",
            code: "MODERATION_BLOCKED",
            details: "This image violates our content policy.",
          });
        }
      }

      // Upload all images to R2
      let imageUrls = [];
      if (imageFiles && imageFiles.length > 0) {
        for (const imageFile of imageFiles) {
          const fileExt = imageFile.originalname.split(".").pop();
          const fileName = `${req.user.uid}-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = `chat-images/${fileName}`;

          try {
            const publicUrl = await r2.uploadFile(
              "chat-attachments",
              filePath,
              imageFile.buffer,
              imageFile.mimetype,
            );
            imageUrls.push(publicUrl);
          } catch (uploadError) {
            console.error("Error uploading image:", uploadError);
            // Clean up already uploaded images
            for (const url of imageUrls) {
              const p = url.split("/chat-attachments/")[1];
              await r2.deleteFile("chat-attachments", p).catch(() => {});
            }
            return res.status(500).json({
              error: "Failed to upload image",
              message: uploadError.message,
            });
          }
        }
        console.log(`Uploaded ${imageUrls.length} images`);
      }

      // Insert message with image URLs and reply_to_id
      let { data, error } = await supabase
        .from("chat_messages")
        .insert({
          chat_id: chatData.id,
          sender_id: req.user.uid,
          message: message,
          image_url: imageUrls.length > 0 ? imageUrls[0] : null, // First image for backward compatibility
          image_urls: imageUrls.length > 0 ? imageUrls : null, // All images as array
          reply_to_id: replyToId, // Add reply reference
          link_preview: message ? await generateLinkPreview(message) : null, // Generate link preview
          created_at: new Date().toISOString(),
        })
        .select(
          `*,
          sender:users!chat_messages_sender_id_fkey(id, first_name, last_name, avatar_url)`,
        )
        .single();

      if (error) throw error;

      // If this is a reply, fetch the replied message data
      if (data.reply_to_id) {
        console.log(
          `Fetching reply_to data for new message, reply_to_id: ${data.reply_to_id}`,
        );
        const { data: repliedMessage, error: replyError } = await supabase
          .from("chat_messages")
          .select(
            `id,
            message,
            image_url,
            image_urls,
            sender:users!chat_messages_sender_id_fkey(id, first_name, last_name, avatar_url)`,
          )
          .eq("id", data.reply_to_id)
          .single();

        if (!replyError && repliedMessage) {
          console.log("Successfully fetched reply_to data:", repliedMessage);
          data = {
            ...data,
            reply_to: repliedMessage,
          };
        } else if (replyError) {
          console.error("Error fetching reply_to:", replyError);
        }
      } else {
        data = {
          ...data,
          reply_to: null,
        };
      }

      // Update chat's last message timestamp
      await supabase
        .from("chats")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", chatData.id);

      // If the other user had deleted this chat, remove the deletion so it reappears
      const otherUserId =
        rollRequest.sender_id === req.user.uid
          ? rollRequest.receiver_id
          : rollRequest.sender_id;
      await supabase
        .from("deleted_chats")
        .delete()
        .eq("chat_id", chatData.id)
        .eq("user_id", otherUserId);

      res.status(200).json(data);

      // Send push notification to the other user (fire and forget)
      try {
        const senderName = data.sender
          ? `${data.sender.first_name} ${data.sender.last_name}`
          : "Someone";
        const previewText =
          imageUrls.length > 0 && !message
            ? "📷 Sent a photo"
            : message.length > 100
              ? message.substring(0, 100) + "..."
              : message || "📷 Sent a photo";

        sendNotification(otherUserId, previewText, {
          title: senderName,
          data: {
            type: "message",
            chat_id: String(chatData.id),
            roll_request_id: String(chatData.roll_request_id || rollRequestId),
            user_id: req.user.uid,
            user_name: senderName,
          },
        });
      } catch (pushError) {
        console.error("Error sending chat push notification:", pushError);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({
        error: "Failed to send message",
        details: error.message,
      });
    }
  },
);

// GET /chat-messages/unread-count — Get total unread message count across all chats
router.get("/chat-messages/unread-count", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    // Get all chats the user is part of
    const { data: friendships, error: friendError } = await supabase
      .from("roll_requests")
      .select("id")
      .eq("status", "accepted")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);

    if (friendError) throw friendError;
    if (!friendships || friendships.length === 0) {
      return res.json({ count: 0 });
    }

    const rollRequestIds = friendships.map((f) => f.id);

    const { data: chats, error: chatError } = await supabase
      .from("chats")
      .select("id")
      .in("roll_request_id", rollRequestIds);

    if (chatError) throw chatError;
    if (!chats || chats.length === 0) {
      return res.json({ count: 0 });
    }

    // Get deleted chat IDs for this user
    const { data: deletedChats } = await supabase
      .from("deleted_chats")
      .select("chat_id")
      .eq("user_id", userId);

    const deletedChatIds = new Set((deletedChats || []).map((d) => d.chat_id));
    const activeChatIds = chats
      .filter((c) => !deletedChatIds.has(c.id))
      .map((c) => c.id);

    if (activeChatIds.length === 0) {
      return res.json({ count: 0 });
    }

    // Count unread messages (not sent by user, not read, not deleted)
    const { count, error: countError } = await supabase
      .from("chat_messages")
      .select("*", { count: "exact", head: true })
      .in("chat_id", activeChatIds)
      .neq("sender_id", userId)
      .is("read_at", null)
      .eq("deleted_for_everyone", false);

    if (countError) throw countError;

    res.json({ count: count || 0 });
  } catch (error) {
    console.error("Error in GET /chat-messages/unread-count:", error);
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
});

// Get chat messages
router.get("/chat-messages/:rollRequestId", verifyToken, async (req, res) => {
  const { rollRequestId } = req.params;
  const currentUserId = req.user.uid;
  console.log("Fetching messages for roll request:", rollRequestId);

  try {
    // First, get the roll request to find the users involved
    const { data: rollRequest, error: rollError } = await supabase
      .from("roll_requests")
      .select("sender_id, receiver_id, status")
      .eq("id", rollRequestId)
      .single();

    if (rollError) {
      console.error("Error fetching roll request:", rollError);
      return res.status(404).json({ error: "Roll request not found" });
    }

    // Only allow chat if request is accepted
    if (rollRequest.status !== "accepted") {
      return res
        .status(403)
        .json({ error: "Roll request must be accepted to chat" });
    }

    const user1 = rollRequest.sender_id;
    const user2 = rollRequest.receiver_id;

    console.log(
      `Looking for chat between users: ${user1} and ${user2} (from roll_request ${rollRequestId})`,
    );

    // ALWAYS check for ANY existing chat between these two users first
    // Find all accepted roll requests between these two users
    const { data: allFriendships, error: friendshipError } = await supabase
      .from("roll_requests")
      .select("id")
      .eq("status", "accepted")
      .or(
        `and(sender_id.eq.${user1},receiver_id.eq.${user2}),and(sender_id.eq.${user2},receiver_id.eq.${user1})`,
      )
      .order("created_at", { ascending: true }); // Get oldest first

    let chatData = null;

    if (!friendshipError && allFriendships && allFriendships.length > 0) {
      console.log(
        `Found ${allFriendships.length} accepted roll requests between these users`,
      );
      // Check if any of these friendships have a chat
      for (const friendship of allFriendships) {
        const { data: existingChat, error: existingChatError } = await supabase
          .from("chats")
          .select("id, roll_request_id")
          .eq("roll_request_id", friendship.id)
          .single();

        if (existingChat && !existingChatError) {
          console.log(
            `Found existing chat ${existingChat.id} from roll request ${friendship.id}`,
          );
          chatData = existingChat;
          break;
        }
      }
    }

    // If still no chat found, create a new one
    if (!chatData) {
      console.log(
        "No existing chat found, creating new chat for roll request:",
        rollRequestId,
      );
      const { data: newChat, error: createError } = await supabase
        .from("chats")
        .insert({
          roll_request_id: rollRequestId,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (createError) throw createError;
      chatData = newChat;
    }

    console.log("Using chat:", chatData);

    // Fetch all messages
    const { data: messages, error: messagesError } = await supabase
      .from("chat_messages")
      .select(
        `*,
        sender:users!chat_messages_sender_id_fkey(id, first_name, last_name, avatar_url)`,
      )
      .eq("chat_id", chatData.id)
      .order("created_at", { ascending: true });

    if (messagesError) {
      console.error("Error fetching messages:", messagesError);
      throw messagesError;
    }

    console.log(
      `Fetched ${messages?.length || 0} messages, ${messages?.filter((m) => m.reply_to_id).length || 0} have reply_to_id`,
    );

    // Filter out deleted messages and process reply_to data
    const messagesWithReplies = await Promise.all(
      (messages || [])
        .filter((message) => {
          // Filter out messages deleted for everyone
          if (message.deleted_for_everyone) return false;
          // Filter out messages deleted for current user
          const isSender = message.sender_id === currentUserId;
          if (isSender && message.deleted_for_sender) return false;
          if (!isSender && message.deleted_for_receiver) return false;
          return true;
        })
        .map(async (message) => {
          if (message.reply_to_id) {
            console.log(
              `Fetching reply_to data for message ${message.id}, reply_to_id: ${message.reply_to_id}`,
            );
            // Fetch the replied message
            const { data: repliedMessage, error: replyError } = await supabase
              .from("chat_messages")
              .select(
                `id,
              message,
              image_url,
              image_urls,
              sender_id,
              deleted_for_everyone,
              sender:users!chat_messages_sender_id_fkey(id, first_name, last_name, avatar_url)`,
              )
              .eq("id", message.reply_to_id)
              .single();

            if (replyError) {
              console.error(
                `Error fetching reply_to for message ${message.id}:`,
                replyError,
              );
              // Return message with null reply_to if error
              return {
                ...message,
                sender: message.sender
                  ? optimizeUserImages(message.sender)
                  : null,
                image_url: message.image_url
                  ? optimizeImageUrl(message.image_url, "medium")
                  : null,
                image_urls: message.image_urls
                  ? message.image_urls.map((url) =>
                      optimizeImageUrl(url, "medium"),
                    )
                  : null,
                reply_to: null,
              };
            }

            if (repliedMessage) {
              // If the replied message was deleted for everyone, show placeholder
              const replyData = repliedMessage.deleted_for_everyone
                ? {
                    id: repliedMessage.id,
                    message: "This message was deleted",
                    image_url: null,
                    image_urls: null,
                    sender: repliedMessage.sender
                      ? optimizeUserImages(repliedMessage.sender)
                      : null,
                  }
                : {
                    ...repliedMessage,
                    sender: repliedMessage.sender
                      ? optimizeUserImages(repliedMessage.sender)
                      : null,
                    image_url: repliedMessage.image_url
                      ? optimizeImageUrl(repliedMessage.image_url, "medium")
                      : null,
                    image_urls: repliedMessage.image_urls
                      ? repliedMessage.image_urls.map((url) =>
                          optimizeImageUrl(url, "medium"),
                        )
                      : null,
                  };

              console.log(
                `Successfully fetched reply_to data for message ${message.id}:`,
                JSON.stringify(repliedMessage, null, 2),
              );
              return {
                ...message,
                sender: message.sender
                  ? optimizeUserImages(message.sender)
                  : null,
                image_url: message.image_url
                  ? optimizeImageUrl(message.image_url, "medium")
                  : null,
                image_urls: message.image_urls
                  ? message.image_urls.map((url) =>
                      optimizeImageUrl(url, "medium"),
                    )
                  : null,
                reply_to: replyData,
              };
            }
          }
          return {
            ...message,
            sender: message.sender ? optimizeUserImages(message.sender) : null,
            image_url: message.image_url
              ? optimizeImageUrl(message.image_url, "medium")
              : null,
            image_urls: message.image_urls
              ? message.image_urls.map((url) => optimizeImageUrl(url, "medium"))
              : null,
            reply_to: null,
          };
        }),
    );

    console.log(
      `Returning ${messagesWithReplies.length} messages, ${messagesWithReplies.filter((m) => m.reply_to).length} with replies`,
    );

    res.status(200).json({
      chat: chatData,
      messages: messagesWithReplies,
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({
      error: "Failed to fetch messages",
      details: error,
    });
  }
});

// DELETE /chat-messages/:messageId — Delete a message
router.delete("/chat-messages/:messageId", verifyToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { delete_for } = req.body; // "me" or "everyone"
    const userId = req.user.uid;

    if (!delete_for || !["me", "everyone"].includes(delete_for)) {
      return res
        .status(400)
        .json({ error: 'delete_for must be "me" or "everyone"' });
    }

    // Get the message
    const { data: message, error: fetchError } = await supabase
      .from("chat_messages")
      .select("id, sender_id, chat_id")
      .eq("id", messageId)
      .single();

    if (fetchError || !message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const isSender = message.sender_id === userId;

    if (delete_for === "everyone") {
      if (!isSender) {
        return res
          .status(403)
          .json({ error: "Only the sender can delete for everyone" });
      }

      const { error } = await supabase
        .from("chat_messages")
        .update({
          deleted_for_everyone: true,
          message: "This message was deleted",
          image_url: null,
          image_urls: null,
        })
        .eq("id", messageId);

      if (error) {
        console.error("Error deleting message for everyone:", error);
        return res
          .status(500)
          .json({ error: "Failed to delete message", message: error.message });
      }
    } else {
      // Delete for me only
      const updateField = isSender
        ? "deleted_for_sender"
        : "deleted_for_receiver";

      const { error } = await supabase
        .from("chat_messages")
        .update({ [updateField]: true })
        .eq("id", messageId);

      if (error) {
        console.error("Error deleting message for me:", error);
        return res
          .status(500)
          .json({ error: "Failed to delete message", message: error.message });
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error in DELETE /chat-messages/:messageId:", error);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

// PATCH /chat-messages/:messageId — Edit a sent text message
const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
router.patch("/chat-messages/:messageId", verifyToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.uid;
    const newText = (req.body.message || "").trim();

    if (!newText) {
      return res.status(400).json({ error: "message is required" });
    }

    const { data: message, error: fetchError } = await supabase
      .from("chat_messages")
      .select(
        "id, sender_id, image_url, image_urls, deleted_for_everyone, created_at",
      )
      .eq("id", messageId)
      .single();

    if (fetchError || !message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Only the original sender can edit.
    if (message.sender_id !== userId) {
      return res
        .status(403)
        .json({ error: "Only the sender can edit this message" });
    }
    if (message.deleted_for_everyone) {
      return res.status(400).json({ error: "Cannot edit a deleted message" });
    }
    // Text-only: reject edits on image/attachment messages.
    if (
      message.image_url ||
      (Array.isArray(message.image_urls) && message.image_urls.length > 0)
    ) {
      return res
        .status(400)
        .json({ error: "Only text messages can be edited" });
    }
    // Edit window.
    const age = Date.now() - new Date(message.created_at).getTime();
    if (age > MESSAGE_EDIT_WINDOW_MS) {
      return res
        .status(403)
        .json({ error: "Edit window has expired (15 minutes)" });
    }

    // Moderate the new text before persisting.
    const textMod = await moderation.checkText({
      text: newText,
      surface: "chat_text",
      userId,
    });
    if (!textMod.allowed) {
      return res.status(422).json({
        error: "Message rejected",
        code: "MODERATION_BLOCKED_TEXT",
        details: "This message violates our content policy.",
      });
    }

    const { data: updated, error } = await supabase
      .from("chat_messages")
      .update({
        message: newText,
        is_edited: true,
        edited_at: new Date().toISOString(),
        link_preview: await generateLinkPreview(newText),
      })
      .eq("id", messageId)
      .select("id, message, is_edited, edited_at")
      .single();

    if (error) {
      console.error("Error editing message:", error);
      return res
        .status(500)
        .json({ error: "Failed to edit message", message: error.message });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error in PATCH /chat-messages/:messageId:", error);
    res.status(500).json({ error: "Failed to edit message" });
  }
});

// POST /chat-messages/:messageId/react — Add or remove a reaction on a message
router.post(
  "/chat-messages/:messageId/react",
  verifyToken,
  async (req, res) => {
    try {
      const { messageId } = req.params;
      const { reaction } = req.body;

      // Allow null/empty to remove reaction
      const reactionValue = reaction || null;

      const { data, error } = await supabase
        .from("chat_messages")
        .update({ reaction: reactionValue })
        .eq("id", messageId)
        .select("id, reaction")
        .single();

      if (error) {
        console.error("Error updating reaction:", error);
        return res
          .status(500)
          .json({ error: "Failed to update reaction", message: error.message });
      }

      if (!data) {
        return res.status(404).json({ error: "Message not found" });
      }

      res.json({ success: true, id: data.id, reaction: data.reaction });
    } catch (error) {
      console.error("Error in POST /chat-messages/:messageId/react:", error);
      res.status(500).json({ error: "Failed to update reaction" });
    }
  },
);

// DELETE /chats/:chatId — Delete a conversation for current user
router.delete("/chats/:chatId", verifyToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.uid;

    // Upsert into deleted_chats
    const { error } = await supabase.from("deleted_chats").upsert(
      {
        chat_id: parseInt(chatId),
        user_id: userId,
      },
      { onConflict: "chat_id,user_id" },
    );

    if (error) {
      console.error("Error deleting conversation:", error);
      return res.status(500).json({
        error: "Failed to delete conversation",
        message: error.message,
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error in DELETE /chats/:chatId:", error);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

// GET /conversations — Optimized conversation list (single endpoint)
router.get("/conversations", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    // 1. Get all accepted friendships for this user
    const { data: friendships, error: friendError } = await supabase
      .from("roll_requests")
      .select("id, sender_id, receiver_id")
      .eq("status", "accepted")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);

    if (friendError) throw friendError;
    if (!friendships || friendships.length === 0) return res.json([]);

    // 2. Get deleted chat IDs for this user
    const { data: deletedChats } = await supabase
      .from("deleted_chats")
      .select("chat_id")
      .eq("user_id", userId);

    const deletedChatIds = new Set((deletedChats || []).map((d) => d.chat_id));

    // 3. Get all chats for these friendships
    const rollRequestIds = friendships.map((f) => f.id);
    const { data: chats, error: chatError } = await supabase
      .from("chats")
      .select("id, roll_request_id, last_message_at, created_at")
      .in("roll_request_id", rollRequestIds);

    if (chatError) throw chatError;
    if (!chats || chats.length === 0) return res.json([]);

    // Filter out deleted chats
    const activeChats = chats.filter((c) => !deletedChatIds.has(c.id));
    if (activeChats.length === 0) return res.json([]);

    // 4. Build a map of roll_request_id -> friendship
    const friendshipMap = {};
    friendships.forEach((f) => {
      friendshipMap[f.id] = f;
    });

    // 5. Get the other user's info for each chat
    const otherUserIds = [
      ...new Set(
        activeChats.map((c) => {
          const f = friendshipMap[c.roll_request_id];
          return f.sender_id === userId ? f.receiver_id : f.sender_id;
        }),
      ),
    ];

    const { data: users } = await supabase
      .from("users")
      .select("id, first_name, last_name, avatar_url, belt")
      .in("id", otherUserIds);

    const userMap = {};
    (users || []).forEach((u) => {
      userMap[u.id] = u;
    });

    // 6. Get the last message for each chat (batch query)
    const chatIds = activeChats.map((c) => c.id);
    const { data: lastMessages } = await supabase
      .from("chat_messages")
      .select(
        "id, chat_id, sender_id, message, image_url, image_urls, created_at, deleted_for_everyone, deleted_for_sender, deleted_for_receiver",
      )
      .in("chat_id", chatIds)
      .order("created_at", { ascending: false });

    // Get unread counts per chat (messages not sent by user, not read)
    const { data: unreadMessages } = await supabase
      .from("chat_messages")
      .select("chat_id")
      .in("chat_id", chatIds)
      .neq("sender_id", userId)
      .is("read_at", null)
      .eq("deleted_for_everyone", false);

    const unreadCountMap = {};
    (unreadMessages || []).forEach((m) => {
      unreadCountMap[m.chat_id] = (unreadCountMap[m.chat_id] || 0) + 1;
    });

    // Group by chat_id and pick the first visible message per chat
    const lastMessageMap = {};
    (lastMessages || []).forEach((m) => {
      if (lastMessageMap[m.chat_id]) return; // already found the latest for this chat

      // Skip messages deleted for this user
      if (m.deleted_for_everyone) {
        // Still show "This message was deleted" as last message
        lastMessageMap[m.chat_id] = {
          ...m,
          message: "This message was deleted",
          image_url: null,
          image_urls: null,
        };
        return;
      }
      const isSender = m.sender_id === userId;
      if (isSender && m.deleted_for_sender) return;
      if (!isSender && m.deleted_for_receiver) return;

      lastMessageMap[m.chat_id] = m;
    });

    // 7. Assemble conversations
    const conversations = activeChats.map((chat) => {
      const friendship = friendshipMap[chat.roll_request_id];
      const otherUserId =
        friendship.sender_id === userId
          ? friendship.receiver_id
          : friendship.sender_id;
      const otherUser = userMap[otherUserId] || {};
      const lastMessage = lastMessageMap[chat.id] || null;

      return {
        chat_id: chat.id,
        roll_request_id: chat.roll_request_id,
        other_user: {
          id: otherUserId,
          first_name: otherUser.first_name || null,
          last_name: otherUser.last_name || null,
          avatar_url: otherUser.avatar_url
            ? optimizeImageUrl(otherUser.avatar_url, "avatar")
            : null,
          belt: otherUser.belt || null,
        },
        last_message: lastMessage
          ? {
              id: lastMessage.id,
              message: lastMessage.message,
              sender_id: lastMessage.sender_id,
              created_at: lastMessage.created_at,
              has_image: !!(
                lastMessage.image_url ||
                (lastMessage.image_urls && lastMessage.image_urls.length > 0)
              ),
            }
          : null,
        unread_count: unreadCountMap[chat.id] || 0,
        last_message_at: chat.last_message_at || chat.created_at,
      };
    });

    // Sort by most recent message
    conversations.sort(
      (a, b) => new Date(b.last_message_at) - new Date(a.last_message_at),
    );

    res.json(conversations);
  } catch (error) {
    console.error("Error in GET /conversations:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch conversations", message: error.message });
  }
});

// POST /chat-messages/read — Mark messages as read in a chat
router.post("/chat-messages/read", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { chat_id } = req.body;

    if (!chat_id) {
      return res.status(400).json({ error: "chat_id is required" });
    }

    // Mark all unread messages in this chat that were NOT sent by the current user
    const { data, error } = await supabase
      .from("chat_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("chat_id", chat_id)
      .neq("sender_id", userId)
      .is("read_at", null)
      .select("id");

    if (error) {
      console.error("Error marking messages as read:", error);
      return res.status(500).json({ error: "Failed to mark messages as read" });
    }

    res.json({ success: true, marked_count: data ? data.length : 0 });
  } catch (error) {
    console.error("Error in POST /chat-messages/read:", error);
    res.status(500).json({ error: "Failed to mark messages as read" });
  }
});

module.exports = router;
