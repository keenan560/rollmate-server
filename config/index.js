const { createClient } = require("@supabase/supabase-js");

// Create a single supabase client for interacting with your database
const supabase = createClient(
  "https://mqdydjnyfmhsmasqqszq.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xZHlkam55Zm1oc21hc3Fxc3pxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzExOTU5NDYsImV4cCI6MjA0Njc3MTk0Nn0.IxAK4GGdYOjOJhToMDK0ljGv-ion0BM_Dl0OXeOtCZY"
);

module.exports = supabase;
