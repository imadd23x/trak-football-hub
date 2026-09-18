import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// T2 — this function used to be called by the child.
//
// It read the coach's private note, generated feedback, and returned both
// straight to the player: no draft, no approval, no record of what a child was
// told, and the private note itself in the response body. The deck says "the
// coach reviews every word"; nothing in the system could hold a reviewed word.
//
// It is now coach-facing. A coach generates a draft, the draft is persisted to
// ai_feedback_drafts (which a child has no grant on), and nothing reaches the
// player until the coach publishes it through publish_player_feedback().
//
// The child-facing follow-up chat has been removed rather than adapted. A live
// conversation cannot be approved in advance by a coach, so it cannot coexist
// with "every AI message a child sees was approved by their coach first". That
// is a product decision as much as a technical one and it is flagged as such;
// if the chat comes back it belongs on the coach's side of the line.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FEEDBACK_SYSTEM = `You are a supportive and motivating football development coach inside the Trak app. You are drafting feedback that a human coach will read, edit and approve before any player sees it. Write it as if speaking to the player, because that is how it will be published once approved.

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { assessment_id } = body;
    if (!assessment_id) return json({ error: "assessment_id required" }, 400);

    // The caller must be a coach. A player calling this gets nothing — which is
    // the whole point of T2, so it is checked before anything else is read.
    const { data: profile } = await supabase
      .from("profiles").select("role").eq("user_id", user.id).maybeSingle();

    if (profile?.role !== "coach") {
      return json({ error: "Only a coach can generate feedback" }, 403);
    }

    // The assessment must be one this coach can see. RLS already restricts
    // coach_assessments to their own roster rows in their own academy, so a
    // row coming back at all is the authorisation — but the roster row is
    // fetched explicitly so the draft can be attributed to it.
    const { data: assessment, error: assessmentError } = await supabase
      .from("coach_assessments")
      .select("id, squad_player_id, coach_rating, work_rate, tactical, attitude, technical, physical, coachability, appearance")
      .eq("id", assessment_id)
      .maybeSingle();

    if (assessmentError) return json({ error: "Could not read that assessment" }, 500);
    if (!assessment) return json({ error: "Assessment not found or access denied" }, 404);

    const { data: squadRow } = await supabase
      .from("squad_players")
      .select("id, player_name, position")
      .eq("id", assessment.squad_player_id)
      .maybeSingle();

    if (!squadRow) return json({ error: "Assessment not found or access denied" }, 404);

    // A note is optional. Requiring one made the whole feature unreachable
    // whenever a coach assessed without writing anything — which, pitch-side,
    // is most of the time. The six category scores are enough to say what to
    // work on.
    const { data: noteRow } = await supabase
      .from("coach_assessment_notes")
      .select("note")
      .eq("assessment_id", assessment_id)
      .maybeSingle();

    const coachNote = noteRow?.note?.trim() ?? "";

    const position = squadRow.position || "outfield player";
    const rating = assessment.coach_rating?.toFixed(1) ?? "—";
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

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: FEEDBACK_SYSTEM },
          { role: "user", content: contextBlock },
        ],
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return json({ error: "Rate limit reached, please try again in a moment." }, 429);
      }
      console.error("AI gateway error", aiResp.status, await aiResp.text());
      return json({ error: "AI error" }, 500);
    }

    const aiJson = await aiResp.json();
    const raw = aiJson.choices?.[0]?.message?.content || "";

    let feedback: { points?: unknown[]; encouragement?: string };
    try {
      const clean = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      feedback = JSON.parse(clean);
    } catch {
      console.error("Failed to parse AI feedback JSON:", raw);
      return json({ error: "Failed to parse AI response" }, 500);
    }

    if (!Array.isArray(feedback?.points) || feedback.points.length === 0) {
      return json({ error: "The model returned nothing usable" }, 500);
    }

    // Persist the draft. A child has no grant on this table, so generating
    // costs nothing in exposure — and a draft that is never approved simply
    // stays where only the coach can see it.
    const { data: draft, error: draftError } = await supabase
      .from("ai_feedback_drafts")
      .insert({
        squad_player_id: squadRow.id,
        assessment_id: assessment.id,
        generated_text: JSON.stringify(feedback),
        model: "google/gemini-3-flash-preview",
      })
      .select("id")
      .maybeSingle();

    // A draft that could not be stored must not be handed back as though it
    // were saved, or a coach approves something with no row behind it.
    if (draftError || !draft) {
      console.error("Could not persist draft", draftError);
      return json({ error: "Generated the draft but could not save it — please try again" }, 500);
    }

    return json({
      draft_id: draft.id,
      feedback,
      context: { playerName, position, rating },
      // The coach's private note is deliberately NOT returned. It used to be,
      // to a child, which is the leak recorded as X9.
    });

  } catch (e) {
    console.error("player-feedback error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
