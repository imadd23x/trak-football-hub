import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// G7: the pilot does not process AI requests, even for authenticated coaches.
// Keep this unconditional: no body, identity, database, secret or provider access.
serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  return new Response(JSON.stringify({
    code: "PILOT_FEATURE_DISABLED",
    error: "AI features are disabled during the pilot.",
  }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
