const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { chatImageUpload } = require("../middleware/upload");
const { generateLinkPreview } = require("../utils/linkPreview");
const {
  optimizeImageUrl,
  optimizeUserImages,
} = require("../utils/imageOptimization");

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

      // Upload all images to storage
      let imageUrls = [];
      if (imageFiles && imageFiles.length > 0) {
        for (const imageFile of imageFiles) {
          const fileExt = imageFile.originalname.split(".").pop();
          const fileName = `${req.user.uid}-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = `chat-images/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from("chat-attachments")
            .upload(filePath, imageFile.buffer, {
              contentType: imageFile.mimetype,
              upsert: false,
            });

          if (uploadError) {
            console.error("Error uploading image:", uploadError);
            // Clean up already uploaded images
            for (const url of imageUrls) {
              const path = url.split("/chat-attachments/")[1];
              await supabase.storage.from("chat-attachments").remove([path]);
            }
            return res.status(500).json({
              error: "Failed to upload image",
              message: uploadError.message,
            });
          }

          const { data: urlData } = supabase.storage
            .from("chat-attachments")
            .getPublicUrl(filePath);

          imageUrls.push(urlData.publicUrl);
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
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({
        error: "Failed to send message",
        details: error.message,
      });
    }
  },
);

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

module.exports = router;
