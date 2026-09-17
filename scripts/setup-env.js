// Switches this local server between the uat/prod Supabase project +
// matching Firebase service account, mirroring rollMate2's setup-env.sh.
// Usage: node scripts/setup-env.js uat|prod
const fs = require("fs");
const path = require("path");

const ENV = process.argv[2];
if (ENV !== "uat" && ENV !== "prod") {
  console.error("Usage: node scripts/setup-env.js [uat|prod]");
  process.exit(1);
}

const PROFILES = {
  uat: {
    SUPABASE_URL: "https://mqdydjnyfmhsmasqqszq.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xZHlkam55Zm1oc21hc3Fxc3pxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMTE5NTk0NiwiZXhwIjoyMDQ2NzcxOTQ2fQ.1zSga71k6TqVcWcgPnON-Mss_aXlfabuwHDeQ7IbuM0",
  },
  prod: {
    SUPABASE_URL: "https://thwvrcebnvztdkawidxo.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || "REPLACE_ME_PROD_SERVICE_ROLE_KEY",
  },
};

const envPath = path.join(__dirname, "..", ".env");
let lines = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, "utf8").split("\n")
  : [];

const profile = { ...PROFILES[ENV], APP_ENV: ENV };

// Drop the one-off base64 override — file-based selection (APP_ENV) takes
// over now, so this key should never be needed for local dev again.
lines = lines.filter((l) => !l.startsWith("FIREBASE_SERVICE_ACCOUNT="));

for (const [key, value] of Object.entries(profile)) {
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const line = `${key}=${value}`;
  if (idx >= 0) lines[idx] = line;
  else lines.push(line);
}

fs.writeFileSync(envPath, lines.join("\n"));
console.log(`✅ Local server env switched to: ${ENV}`);
if (ENV === "prod" && profile.SUPABASE_SERVICE_ROLE_KEY === "REPLACE_ME_PROD_SERVICE_ROLE_KEY") {
  console.log("⚠️  Prod SUPABASE_SERVICE_ROLE_KEY is a placeholder — set PROD_SUPABASE_SERVICE_ROLE_KEY env var and rerun, or edit .env directly.");
}
console.log("Restart your server (npm start / npm run dev) for this to take effect.");
