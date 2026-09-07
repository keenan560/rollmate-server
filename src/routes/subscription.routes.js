const express = require("express");
const router = express.Router();
const supabase = require("../../config");
const { verifyToken } = require("../middleware/auth");
const { isUserSubscribed } = require("../services/subscription");

// GET /subscriptions/me — current user's premium entitlement status.
// Frontend calls this once (e.g. on app load) to decide whether to show
// premium content directly or route taps through the paywall.
router.get("/subscriptions/me", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    const { data, error } = await supabase
      .from("subscriptions")
      .select("status, product_id, current_period_end")
      .eq("user_id", userId)
      .order("current_period_end", { ascending: false })
      .limit(1);
    if (error) throw error;

    const subscribed = await isUserSubscribed(userId);
    const latest = data && data[0] ? data[0] : null;

    res.json({
      is_subscribed: subscribed,
      status: latest?.status || "none",
      product_id: latest?.product_id || null,
      current_period_end: latest?.current_period_end || null,
    });
  } catch (error) {
    console.error("[subscriptions] status error:", error.message);
    res.status(500).json({ error: "Failed to fetch subscription status" });
  }
});

const ACTIVE_EVENT_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "NON_RENEWING_PURCHASE",
]);
const GRACE_EVENT_TYPES = new Set(["BILLING_ISSUE"]);
const EXPIRED_EVENT_TYPES = new Set(["EXPIRATION"]);

// POST /webhooks/revenuecat — keeps the `subscriptions` table (the source
// of truth every gated route checks) in sync with real purchase events.
// Configure this URL + REVENUECAT_WEBHOOK_SECRET as the Authorization
// header value in the RevenueCat dashboard's webhook settings.
//
// CANCELLATION/TRANSFER/TEST events are intentionally ignored — RevenueCat's
// own guidance is that a cancellation doesn't revoke access immediately
// (the user paid through the end of the period), so we wait for the actual
// EXPIRATION event instead of reacting to the cancel intent.
router.post("/webhooks/revenuecat", async (req, res) => {
  try {
    const expectedSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (expectedSecret && req.headers.authorization !== `Bearer ${expectedSecret}`) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    const event = req.body?.event;
    if (!event || !event.app_user_id) {
      return res.status(400).json({ error: "Missing event payload" });
    }

    const userId = event.app_user_id;
    const eventType = event.type;

    let status = null;
    if (ACTIVE_EVENT_TYPES.has(eventType)) status = "active";
    else if (GRACE_EVENT_TYPES.has(eventType)) status = "in_grace_period";
    else if (EXPIRED_EVENT_TYPES.has(eventType)) status = "expired";

    if (!status) {
      console.log(`[revenuecat webhook] ignoring event type: ${eventType}`);
      return res.json({ received: true });
    }

    const productId = event.product_id || null;
    const periodEnd = event.expiration_at_ms
      ? new Date(event.expiration_at_ms).toISOString()
      : null;

    const { data: existing, error: findErr } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", "revenuecat")
      .order("created_at", { ascending: false })
      .limit(1);
    if (findErr) throw findErr;

    if (existing && existing.length > 0) {
      const { error: updateErr } = await supabase
        .from("subscriptions")
        .update({
          status,
          product_id: productId,
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing[0].id);
      if (updateErr) throw updateErr;
    } else {
      const { error: insertErr } = await supabase.from("subscriptions").insert({
        user_id: userId,
        provider: "revenuecat",
        product_id: productId,
        status,
        current_period_end: periodEnd,
      });
      if (insertErr) throw insertErr;
    }

    console.log(
      `[revenuecat webhook] ${eventType} for ${userId} -> status=${status}`,
    );
    res.json({ received: true });
  } catch (error) {
    console.error("[revenuecat webhook] error:", error.message);
    res.status(500).json({ error: "Failed to process webhook" });
  }
});

module.exports = router;
