const { createClient } = require("@supabase/supabase-js");

// Create a single supabase client for interacting with your database
const supabase = createClient(
  "https://mqdydjnyfmhsmasqqszq.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xZHlkam55Zm1oc21hc3Fxc3pxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMTE5NTk0NiwiZXhwIjoyMDQ2NzcxOTQ2fQ.1zSga71k6TqVcWcgPnON-Mss_aXlfabuwHDeQ7IbuM0",
);

module.exports = supabase;
