const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { sendNotification } = require("../services/notification");

// Send roll request
router.post("/roll-request", verifyToken, async (req, res) => {
  try {
    const { data: existingRequest, error: checkError } = await supabase
      .from("roll_requests")
      .select("*")
      .eq("sender_id", req.user.uid)
      .eq("receiver_id", req.body.receiver_id)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      throw checkError;
    }

    let data;
    if (existingRequest) {
      if (
        existingRequest.status === "declined" ||
        existingRequest.status === "cancelled"
      ) {
        const { data: updatedRequest, error: updateError } = await supabase
          .from("roll_requests")
          .update({
            status: "pending",
            created_at: new Date().toISOString(),
            responded_at: null,
          })
          .eq("id", existingRequest.id)
          .select()
          .single();

        if (updateError) throw updateError;
        data = updatedRequest;
      } else {
        return res.status(400).json({
          error: `Cannot create new request. Existing request status: ${existingRequest.status}`,
          existingRequest,
        });
      }
    } else {
      const { data: newRequest, error } = await supabase
        .from("roll_requests")
        .insert({
          sender_id: req.user.uid,
          receiver_id: req.body.receiver_id,
          status: "pending",
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      data = newRequest;
    }

    const { data: senderData } = await supabase
      .from("users")
      .select("first_name, last_name, avatar_url")
      .eq("id", req.user.uid)
      .single();

    await sendNotification(
      req.body.receiver_id,
      `${senderData.first_name} ${senderData.last_name} wants to be friends!`,
    );

    // Create in-app notification (fire and forget)
    try {
      await supabase.from("notifications").insert({
        user_id: req.body.receiver_id,
        type: "friend_request",
        title: `${senderData.first_name} ${senderData.last_name} wants to be friends!`,
        actor_id: req.user.uid,
        actor_name: `${senderData.first_name} ${senderData.last_name}`,
        actor_avatar: senderData.avatar_url || null,
        reference_id: data.id,
      });
    } catch (_) {}

    res.status(200).json({
      message: "Friend request sent successfully",
      data,
    });
  } catch (error) {
    console.error("Error sending roll request:", error);
    res.status(500).json({
      error: "Failed to send friend request",
      details: error,
    });
  }
});

// Get roll requests
router.get("/roll-requests", verifyToken, async (req, res) => {
  try {
    const { data: receivedRequests, error: receivedError } = await supabase
      .from("roll_requests")
      .select("*, sender:users!sender_id(*)")
      .eq("receiver_id", req.user.uid)
      .order("created_at", { ascending: false });

    const { data: sentRequests, error: sentError } = await supabase
      .from("roll_requests")
      .select("*, receiver:users!receiver_id(*)")
      .eq("sender_id", req.user.uid)
      .order("created_at", { ascending: false });

    if (receivedError || sentError) throw receivedError || sentError;

    res.status(200).json({
      received: receivedRequests,
      sent: sentRequests,
    });
  } catch (error) {
    console.error("Error fetching roll requests:", error);
    res.status(500).json({
      error: "Failed to fetch roll requests",
    });
  }
});

// Respond to roll request
router.post(
  "/roll-request/:requestId/respond",
  verifyToken,
  async (req, res) => {
    const { requestId } = req.params;
    const { status } = req.body;

    console.log("Request ID:", requestId);
    console.log("Status:", status);
    console.log("User ID:", req.user.uid);

    try {
      const { data: request, error: fetchError } = await supabase
        .from("roll_requests")
        .select(
          `
        *,
        sender:users!sender_id(*),
        receiver:users!receiver_id(*)
      `,
        )
        .eq("id", requestId)
        .single();

      if (fetchError) {
        console.log("Fetch error:", fetchError);
        return res.status(404).json({
          error: "Roll request not found",
          details: fetchError,
        });
      }

      if (status === "cancelled") {
        if (request.status === "accepted") {
          // Either party can unfriend an accepted friendship
          if (
            request.sender_id !== req.user.uid &&
            request.receiver_id !== req.user.uid
          ) {
            return res.status(403).json({
              error: "Not authorized to remove this friendship",
            });
          }
        } else if (request.sender_id !== req.user.uid) {
          // Only the sender can cancel a pending request
          return res.status(403).json({
            error: "Only the sender can cancel a request",
          });
        }
      } else {
        if (request.receiver_id !== req.user.uid) {
          return res.status(403).json({
            error: "Only the receiver can accept/decline a request",
          });
        }
      }

      console.log("Attempting to update request status...");
      const { data, error } = await supabase
        .from("roll_requests")
        .update({
          status,
          responded_at: new Date().toISOString(),
        })
        .eq("id", requestId)
        .select(
          `
        *,
        sender:users!sender_id(*),
        receiver:users!receiver_id(*)
      `,
        )
        .single();

      if (error) {
        console.error("Update error:", error);
        return res.status(500).json({
          error: "Failed to update roll request status",
          details: error,
        });
      }

      // ✅ INCREMENT FRIENDS COUNT WHEN REQUEST IS ACCEPTED
      if (status === "accepted") {
        try {
          console.log("Incrementing friends count for both users...");

          // Increment sender's friends count
          const { error: senderError } = await supabase.rpc(
            "increment_friends_count",
            { user_id: request.sender_id },
          );

          if (senderError) {
            console.warn(
              "Failed to increment sender friends count:",
              senderError,
            );
          }

          // Increment receiver's friends count
          const { error: receiverError } = await supabase.rpc(
            "increment_friends_count",
            { user_id: request.receiver_id },
          );

          if (receiverError) {
            console.warn(
              "Failed to increment receiver friends count:",
              receiverError,
            );
          }

          console.log("Friends count updated successfully for both users");

          // Send notification to sender that request was accepted
          try {
            await sendNotification(
              request.sender.id,
              `${request.receiver.first_name} accepted your friend request!`,
            );
          } catch (notificationError) {
            console.warn("Notification error:", notificationError);
          }
        } catch (countError) {
          console.error("Error updating friends count:", countError);
          // Don't fail the request if count update fails
        }
      }

      // ✅ DECREMENT FRIENDS COUNT WHEN ACCEPTED FRIENDSHIP IS CANCELLED
      if (status === "cancelled" && request.status === "accepted") {
        try {
          console.log("Decrementing friends count for both users...");

          const { error: senderError } = await supabase.rpc(
            "decrement_friends_count",
            { user_id_param: request.sender_id },
          );

          if (senderError) {
            console.warn(
              "Failed to decrement sender friends count:",
              senderError,
            );
          }

          const { error: receiverError } = await supabase.rpc(
            "decrement_friends_count",
            { user_id_param: request.receiver_id },
          );

          if (receiverError) {
            console.warn(
              "Failed to decrement receiver friends count:",
              receiverError,
            );
          }

          console.log("Friends count decremented for both users");
        } catch (countError) {
          console.error("Error decrementing friends count:", countError);
        }
      }

      if (status === "declined") {
        try {
          await sendNotification(
            request.sender.id,
            `${request.receiver.first_name} has declined your roll request`,
          );
        } catch (notificationError) {
          console.warn("Notification error:", notificationError);
        }
      } else if (status === "cancelled") {
        try {
          if (request.status === "accepted") {
            // Unfriend notification — notify the other party
            const otherUserId =
              req.user.uid === request.sender_id
                ? request.receiver.id
                : request.sender.id;
            const currentUserName =
              req.user.uid === request.sender_id
                ? request.sender.first_name
                : request.receiver.first_name;
            await sendNotification(
              otherUserId,
              `${currentUserName} has removed you as a friend`,
            );
          } else {
            await sendNotification(
              request.receiver.id,
              `${request.sender.first_name} has cancelled their roll request`,
            );
          }
        } catch (notificationError) {
          console.warn("Notification error:", notificationError);
        }
      }

      res.status(200).json({
        message: `Roll request ${status}`,
        data,
      });
    } catch (error) {
      console.error("Error in roll request response:", error);
      res.status(500).json({
        error: `Failed to respond to roll request: ${error.message}`,
        details: error,
      });
    }
  },
);

module.exports = router;
