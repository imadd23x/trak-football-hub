import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// This one already authenticated properly, so it was never open to strangers.
// The cap is for the other half of the problem: one authenticated account can
// still spend without limit. Set high — a child re-reading their feedback or
// asking follow-up questions should never meet it in ordinary use.
const DAILY_CALL_LIMIT = 200;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// System prompt for initial feedback generation
const FEEDBACK_SYSTEM = `You are a supportive and motivating football development coach inside the Trak app. Your job is to help young players understand their coach's feedback and give them clear, practical steps to improve.

LANGUAGE RULES:
- Write directly to the player ("you", "your") — not about them.
- Keep it encouraging and honest. Acknowledge what they're already doing well even when pointing out areas to improve.
- Short sentences. Plain English. No jargon.
- Age-appropriate: these are youth players (typically 10–18 years old).
- Never be harsh or discouraging. Frame everything as an opportunity.

OUTPUT FORMAT — always respond with exactly this JSON structure (no other text, no markdown fences):
{
  "points": [
    {
      "title": "Short title (3-5 words)",
      "what": "One sentence describing the specific thing to work on.",
      "why": "One sentence on why this matters for their position and development.",
      "drill": "One concrete thing they can practise — specific enough to do at training or even alone."
    },
    { ... },
    { ... }
  ],
  "encouragement": "One warm closing sentence that acknowledges their effort and motivates them."
}

Rules:
- Always return exactly 3 points.
- "drill" must be a specific action, not vague advice. E.g. "Set up 5 cones in a line and dribble through them at speed, then shoot" not just "practise your dribbling".
- Keep each field concise — title under 6 words, what/why/drill under 30 words each.`;

// System prompt for follow-up chat
const CHAT_SYSTEM = `You are a supportive football development coach chatting with a young player inside the Trak app. The player has received specific feedback from their coach about areas to improve. Your job is to answer their follow-up questions clearly and practically.

RULES:
- Write directly to the player ("you", "your").
- Be warm, encouraging, and specific.
- Short answers are better. Aim for 2-4 sentences per response.
- If asked about a drill or exercise, give one specific, clear thing they can do.
- If asked something unrelated to football or their development, gently redirect.
- Never make up facts about the player that weren't in the original feedback.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the caller is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { assessment_id, chat_messages } = body;

    if (!assessment_id) {
      return new Response(JSON.stringify({ error: "assessment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Counted after the request is known to be well-formed, so a malformed
    // body does not consume someone's allowance.
    const { data: allowed, error: quotaError } = await supabase
      .rpc("claim_ai_call", { p_function_name: "player-feedback", p_daily_limit: DAILY_CALL_LIMIT });

    if (quotaError) {
      console.error("quota check failed", quotaError);
      return new Response(JSON.stringify({ error: "Could not verify your daily allowance" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "You've reached today's limit for feedback. Try again tomorrow." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch the assessment — it must belong to a squad_player linked to this user
    const { data: squadRow } = await supabase
      .from("squad_players")
      .select("id, player_name, position")
      .eq("linked_player_id", user.id)
      .maybeSingle();

    if (!squadRow) {
      return new Response(JSON.stringify({ error: "No squad link found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the assessment
    const { data: assessment } = await supabase
      .from("coach_assessments")
      .select("squad_player_id, coach_rating, work_rate, tactical, attitude, technical, physical, coachability, appearance")
      .eq("id", assessment_id)
      .eq("squad_player_id", squadRow.id)
      .maybeSingle();

    if (!assessment) {
      return new Response(JSON.stringify({ error: "Assessment not found or access denied" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the coach note
    const { data: noteRow } = await supabase
      .from("coach_assessment_notes")
      .select("note")
      .eq("assessment_id", assessment_id)
      .maybeSingle();

    // A note is optional. Requiring one made the whole feedback screen
    // unreachable whenever a coach assessed without writing anything — which,
    // pitch-side, is most of the time. The six category scores are themselves
    // enough to say what to work on, so fall back to them rather than 404.
    const coachNote = noteRow?.note?.trim() ?? "";

    const position = squadRow.position || "outfield player";
    const rating = assessment.coach_rating?.toFixed(1) || "—";
    const appearance = assessment.appearance || "match";
    const playerName = squadRow.player_name?.split(" ")[0] || "the player";

    const contextBlock = `Player: ${playerName}
Position: ${position}
Appearance type: ${appearance}
Overall rating: ${rating}/10
Work rate: ${assessment.work_rate}/10, Technical: ${assessment.technical}/10, Physical: ${assessment.physical}/10, Tactical: ${assessment.tactical}/10, Attitude: ${assessment.attitude}/10, Coachability: ${assessment.coachability}/10

${coachNote
  ? `Coach's improvement notes:\n"${coachNote}"`
  : `The coach did not write a note for this assessment. Base the feedback only on the category scores above: pick the lowest one or two and say what to work on. Do not invent or imply anything the coach said.`}`;

    // If chat_messages provided → it's a follow-up chat, stream a conversational reply
    if (Array.isArray(chat_messages) && chat_messages.length > 0) {
      const systemContent = `${CHAT_SYSTEM}

Context — this player's recent feedback from their coach:
${contextBlock}`;

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          stream: true,
          messages: [
            { role: "system", content: systemContent },
            ...chat_messages,
          ],
        }),
      });

      if (!aiResp.ok) {
        const t = await aiResp.text();
        console.error("AI gateway error", aiResp.status, t);
        return new Response(JSON.stringify({ error: "AI error" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(aiResp.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // Initial feedback generation — not streamed, returns JSON
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        stream: false,
        messages: [
          { role: "system", content: FEEDBACK_SYSTEM },
          { role: "user", content: `Generate structured improvement feedback for this player:\n\n${contextBlock}` },
        ],
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached, please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "AI error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const raw = aiJson.choices?.[0]?.message?.content || "";

    // Parse the JSON from the AI response
    let feedback: any;
    try {
      // Strip markdown fences if present
      const clean = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      feedback = JSON.parse(clean);
    } catch {
      console.error("Failed to parse AI feedback JSON:", raw);
      return new Response(JSON.stringify({ error: "Failed to parse AI response" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      feedback,
      context: {
        // `coachNote`, not `noteRow.note`. maybeSingle() returns null when the
        // coach assessed without writing anything, and the comment above says
        // that is most of the time pitch-side. Dereferencing noteRow here threw
        // a TypeError into the outer catch, so the fallback four lines up bought
        // nothing: the screen still failed, as a 500 instead of a 404, after the
        // AI call had already been made and a daily claim spent.
        //
        // "" is what the player sees when there is no note, and PlayerFeedback
        // already guards on `context?.note &&`, so it renders nothing.
        note: coachNote,
        playerName,
        position,
        rating,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("player-feedback error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
