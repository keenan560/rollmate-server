const supabase = require("../../config");

// Reads the subscriptions table (populated by RevenueCat webhooks once
// wired up). Until then it's empty and every user reads as unsubscribed.
async function isUserSubscribed(userId) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("current_period_end")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("current_period_end", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[subscription] check error:", error.message);
    return false;
  }
  if (!data || data.length === 0) return false;

  const { current_period_end } = data[0];
  if (current_period_end && new Date(current_period_end) < new Date()) {
    return false;
  }
  return true;
}

module.exports = { isUserSubscribed };
