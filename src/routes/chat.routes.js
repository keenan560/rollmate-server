const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { chatImageUpload } = require("../middleware/upload");

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

      if (isNaN(rollRequestId)) {
        return res.status(400).json({ error: "Invalid chat ID" });
      }

      console.log("Received message:", {
        rollRequestId,
        messageLength: message.length,
        imageCount: imageFiles ? imageFiles.length : 0,
      });

      let { data: chatData, error: chatError } = await supabase
        .from("chats")
        .select("id")
        .eq("roll_request_id", rollRequestId)
        .single();

      if (chatError) {
        if (chatError.code === "PGRST116") {
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
        } else {
          throw chatError;
        }
      }

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

      // Insert message with image URLs
      const { data, error } = await supabase
        .from("chat_messages")
        .insert({
          chat_id: chatData.id,
          sender_id: req.user.uid,
          message: message,
          image_url: imageUrls.length > 0 ? imageUrls[0] : null, // First image for backward compatibility
          image_urls: imageUrls.length > 0 ? imageUrls : null, // All images as array
          created_at: new Date().toISOString(),
        })
        .select(
          `*,
          sender:users!sender_id(id, first_name, last_name, avatar_url)`,
        )
        .single();

      if (error) throw error;

      // Update chat's last message timestamp
      await supabase
        .from("chats")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", chatData.id);

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
  console.log("Fetching messages for roll request:", rollRequestId);

  try {
    let { data: chatData, error: chatError } = await supabase
      .from("chats")
      .select("id")
      .eq("roll_request_id", rollRequestId)
      .single();

    if (chatError) {
      if (chatError.code === "PGRST116") {
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
      } else {
        throw chatError;
      }
    }

    console.log("Found/Created chat:", chatData);

    const { data: messages, error: messagesError } = await supabase
      .from("chat_messages")
      .select(
        `*,
        sender:users!sender_id(id, first_name, last_name, avatar_url)`,
      )
      .eq("chat_id", chatData.id)
      .order("created_at", { ascending: true });

    if (messagesError) throw messagesError;

    res.status(200).json({
      chat: chatData,
      messages: messages || [],
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({
      error: "Failed to fetch messages",
      details: error,
    });
  }
});

module.exports = router;
