import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { fillTimeKnown } from "./time-known.ts";

// A coach parsing a season's fixtures might reasonably do it a handful of
// times while getting the input right. This is a ceiling on abuse, not a
// budget for normal use.
const DAILY_CALL_LIMIT = 40;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a sports schedule parser for a youth football academy app.
Extract every distinct event (match, training, tournament, friendly, meeting, etc.) from the user's input.
Return ONLY valid JSON via the provided tool. Use ISO 8601 for timestamps.
If the year is missing, assume the current or next occurrence (whichever is closest in the future).
Never invent opponents or venues — leave them empty if not stated.
Event types must be one of: match, training, tournament, other.

TIME KNOWN vs TIME MISSING — read this carefully, it is the one thing callers cannot work out for themselves.
- If the input states a time for an event, set time_known to true.
- If the input gives only a day with no time, set time_known to false, set starts_at to that date at 00:00, and put a note like "time TBC".
- An event the input explicitly places at midnight ("kick-off 00:00", "midnight friendly") has a KNOWN time: set time_known to true and starts_at to 00:00.
Never infer time_known from the value of starts_at. Report what the input said.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Authenticate before spending anything. This function had no check at
    // all: verify_jwt was off and the body forwarded straight to the paid
    // gateway, so any unauthenticated request on the internet could spend
    // LOVABLE_API_KEY, image input included.
    //
    // The platform gate alone would not be enough even when enabled — the
    // publishable anon key is a validly-signed JWT and ships in the client
    // bundle, so verify_jwt accepts it. Only getUser() proves a real session.
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only coaches have a schedule to parse. Checked through the profile
    // rather than assumed from the caller reaching this endpoint.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profile?.role !== "coach") {
      return new Response(JSON.stringify({ error: "Coaches only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { text, imageBase64, imageMimeType, todayISO } = await req.json();
    if (!text && !imageBase64) {
      return new Response(JSON.stringify({ error: "Provide text or imageBase64" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Count the call before making it. An authenticated coach can still run
    // the bill up without this, by accident or otherwise.
    //
    // Claimed only once the request is known to be well-formed, so a malformed
    // body does not consume someone's allowance — a coach who fires an empty
    // import three times should not have lost three of their forty. The first
    // version of this claimed before parsing; Imad caught it on #41. The rule
    // is: reject everything that costs nothing to reject, then charge.
    const { data: allowed, error: quotaError } = await supabase
      .rpc("claim_ai_call", { p_function_name: "parse-schedule", p_daily_limit: DAILY_CALL_LIMIT });

    if (quotaError) {
      console.error("quota check failed", quotaError);
      return new Response(JSON.stringify({ error: "Could not verify your daily allowance" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: `Daily limit of ${DAILY_CALL_LIMIT} schedule imports reached. Try again tomorrow.` }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userParts: any[] = [];
    const todayLine = `Today is ${todayISO || new Date().toISOString().slice(0, 10)}.`;
    if (text) userParts.push({ type: "text", text: `${todayLine}\n\nSchedule input:\n${text}` });
    else userParts.push({ type: "text", text: `${todayLine}\n\nExtract all events from the attached image.` });
    if (imageBase64) {
      userParts.push({
        type: "image_url",
        image_url: { url: `data:${imageMimeType || "image/jpeg"};base64,${imageBase64}` },
      });
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userParts },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_events",
              description: "Return the extracted schedule events.",
              parameters: {
                type: "object",
                properties: {
                  events: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        event_type: { type: "string", enum: ["match", "training", "tournament", "other"] },
                        starts_at: { type: "string", description: "ISO 8601 timestamp" },
                        ends_at: { type: "string", description: "ISO 8601 timestamp or empty" },
                        time_known: {
                          type: "boolean",
                          description:
                            "True if the input stated a time for this event, false if it gave only a day. " +
                            "An event explicitly placed at midnight by the input is time_known = true.",
                        },
                        venue: { type: "string" },
                        opponent: { type: "string" },
                        notes: { type: "string" },
                      },
                      required: ["title", "event_type", "starts_at", "time_known"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["events"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_events" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached, please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in your Lovable workspace." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall?.function?.arguments;
    let parsed: any = { events: [] };
    if (args) {
      try { parsed = typeof args === "string" ? JSON.parse(args) : args; }
      catch (e) { console.error("Parse failed", e); }
    }

    // Callers need time_known to be a boolean every time, or they are back to
    // guessing. See time-known.ts for why the fallback is what it is.
    fillTimeKnown(parsed);

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-schedule error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});