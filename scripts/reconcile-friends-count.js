// Reconcile users.friends_count to the true number of distinct, existing,
// accepted friendships (derived from roll_requests). Fixes counters that have
// drifted (e.g. missed decrements, seed data).
//
// Runs against whatever database SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY point
// to. Run with:  node scripts/reconcile-friends-count.js
//
// Pass --dry to preview changes without writing.

const supabase = require("../config");

const DRY = process.argv.includes("--dry");

(async () => {
  console.log(
    `Reconciling friends_count${DRY ? " (DRY RUN — no writes)" : ""}...`,
  );

  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("id, friends_count");
  if (usersErr) {
    console.error("Failed to load users:", usersErr.message);
    process.exit(1);
  }
  const existing = new Set((users || []).map((u) => u.id));

  const { data: rrs, error: rrErr } = await supabase
    .from("roll_requests")
    .select("sender_id, receiver_id")
    .eq("status", "accepted");
  if (rrErr) {
    console.error("Failed to load roll_requests:", rrErr.message);
    process.exit(1);
  }

  // Build undirected friendship graph, counting only edges where BOTH users
  // still exist, de-duplicated per pair.
  const friends = new Map();
  const add = (a, b) => {
    if (!friends.has(a)) friends.set(a, new Set());
    friends.get(a).add(b);
  };
  for (const rr of rrs || []) {
    const { sender_id: a, receiver_id: b } = rr;
    if (!a || !b || a === b) continue;
    if (!existing.has(a) || !existing.has(b)) continue;
    add(a, b);
    add(b, a);
  }

  let updated = 0;
  let checked = 0;
  for (const u of users || []) {
    checked++;
    const correct = friends.has(u.id) ? friends.get(u.id).size : 0;
    if ((u.friends_count || 0) === correct) continue;

    console.log(`  ${u.id}: ${u.friends_count} → ${correct}`);
    if (!DRY) {
      const { error } = await supabase
        .from("users")
        .update({ friends_count: correct })
        .eq("id", u.id);
      if (error) {
        console.error(`    ! failed: ${error.message}`);
        continue;
      }
    }
    updated++;
  }

  console.log(
    `Checked ${checked} users; ${DRY ? "would update" : "updated"} ${updated}.`,
  );
  process.exit(0);
})();
