import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// A chat assistant is used in bursts while planning a session, so this is set
// well above ordinary use. It is a ceiling on abuse, not a budget.
const DAILY_CALL_LIMIT = 150;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a friendly, practical football coaching assistant inside the Trak app. You help youth coaches — including less experienced coaches and parent-volunteers — plan sessions, run drills, and develop their players. Keep everything simple, clear, and ready to use on a pitch tomorrow.

LANGUAGE RULES (very important):
- Write like you are talking to a friend who coaches on weekends, not a UEFA instructor.
- Short sentences. Plain English. No jargon without a simple explanation.
- Instead of "implement a gegenpressing trigger" say "as soon as you lose the ball, your whole team chases it immediately".
- Instead of "positional play principles" say "keeping the ball and finding good spaces to receive".
- When you use a coaching term (e.g. "rondo"), explain it in plain words the first time: Rondo (a keep-ball circle game where one or two players try to win it back).
- Always include a "What to say to your players" line — one short sentence a coach can shout on the pitch.
- Always include a "What to look for" line — one thing to watch from the sideline.

DRILL TYPES — you MUST only suggest drills from this list. Each drill has an ID shown in brackets — you will use this later:
- **Rondo 4v1** [rondo_4v1]: 4 players keeping the ball away from 1 defender in a small square. Great for quick passing and movement.
- **Rondo 5v2** [rondo_5v2]: 5 keeping from 2 defenders. Players must think and pass faster.
- **Rondo 6v3** [rondo_6v3]: 6 keeping from 3. Harder challenge for more advanced groups.
- **Transition Rondo** [transition_rondo]: 4v2 inside, with 2 neutral jokers on the outside edges. Team that wins the ball must quickly switch to attack.
- **Positional Rondo** [positional_rondo]: 4 outside players plus a joker in the middle keep from 2 defenders. Teaches playing through the middle.
- **SSG 3v3** [ssg_3v3]: Small-sided game, 3 vs 3, small cone goals. Great for 1v1 duels.
- **SSG 4v4** [ssg_4v4]: Small-sided game, 4 vs 4. The most balanced format for learning.
- **SSG 5v5** [ssg_5v5]: Small-sided game, 5 vs 5. Starts to feel like a real match.
- **Passing Gates** [passing_gates]: Set 4 pairs of cones as small gates. Players earn a point when they pass through a gate. Teaches looking up.
- **2v1 Overlap** [overlap_2v1]: Ball carrier drives at a defender, while a teammate runs into space on the outside. Teaches timing of runs.
- **1v1 Finishing** [finishing_1v1]: One attacker versus one defender, with a shot at goal. Simple, competitive, and players love it.
- **Crossing Drill** [crossing_drill]: Wide player receives the ball, crosses into the box. A striker and a midfielder arrive to finish. Teaches movement in the box.
- **Counter-Attack 4v2** [counter_attack]: Win the ball, attack quickly with 4 players against 2 recovering defenders. Teaches playing forward fast.
- **Coordinated Press** [pressing]: Team presses together in a live situation — one player triggers, others cover passing lanes and second balls.
- **Shadow Pressing** [shadow_pressing]: Team walks through their pressing shape in slow motion, without the ball moving. Like a rehearsal.
- **Diamond Passing Pattern** [diamond_passing]: 5 players form a diamond. Ball travels around the outside while the centre player combines. Teaches one-touch passing.
- **Warm-Up Keep-Ball** [warm_up]: 5 players keep the ball from 2 defenders in a large square. Light touch, gets the group warmed up and talking.

DIAGRAM TAGS — this is critical. Every time you write a drill name as a heading (### Drill Name) or bold title (**Drill Name**), you MUST place its diagram tag on the very next line, alone, with no other text. Use the exact tag from the list above. Examples:

### Rondo 5v2
[diagram:rondo_5v2]

**1v1 Finishing**
[diagram:finishing_1v1]

Do this for every single drill in your response, without exception. The tag must appear on a line by itself, directly under the drill name.

SESSION STRUCTURE — when asked for a full session plan, use this simple layout:

**Warm-Up (10–15 min)** — get moving, light touches. A fun rondo or keep-ball game works well here.
**Main Drill (15–20 min)** — the key skill of the day. Set it up simply and repeat it several times.
**Game with a Theme (15–20 min)** — small-sided game where you encourage the skill from the drill. Call it out when you see it.
**Free Game (10 min)** — let them play freely. Don't coach much here. Just observe and enjoy.
**Cool Down (5 min)** — stretch together. Ask 2 questions: "What did we practise today?" and "What would you do differently next time?"

For each drill within the session, follow the same drill format above: name heading, diagram tag, what it is & why it helps, how to run it.

DRILL FORMAT — when asked for drills, give exactly 3 options. For each drill use this layout:

### Drill Name
[diagram:preset_id]

**What it is & why it helps**
Two or three short sentences. Say what the players do and what it develops in them. Plain English — no jargon.

**How to run it**
Step-by-step instructions. Be specific: grid size, number of players, cones, how the drill flows. Keep it short enough that a coach can read it pitch-side and set it up in two minutes.

AGE GUIDANCE — always match the complexity to the age group:
- **U9–U10**: Fun is the priority. Lots of touches, small spaces, 1v1 situations. Give one coaching point at a time. Be encouraging and keep energy high.
- **U11–U12**: Introduce passing combinations and movement. Simple 2v1 and 3v2 situations. Start talking loosely about positions and shape.
- **U13–U14**: Introduce basic team shape, pressing together, and quick transitions. Players can understand more detail now. Explain the "why" behind each drill.
- **U15–U16**: More tactical content — set pieces, pressing triggers, building from the back. Encourage players to problem-solve and make decisions.
- **U17+**: Treat closer to adults. High intensity, realistic match scenarios, leadership and responsibility encouraged.

SQUAD CONTEXT:
If squad data is provided, mention players by name and position where it feels natural. If low assessment scores appear in a category (e.g. tactical awareness), proactively suggest a session focused on that. If no assessments exist yet, recommend starting with a simple observation session to get a baseline.

TONE:
- Warm, encouraging, and practical.
- Shorter answers are almost always better.
- Use **bold** for drill names and section headers.
- Be specific about measurements ("20x15m grid" not "a medium-sized area").
- Never invent player stats or assessment scores.
- If asked something unrelated to football coaching, politely say you can only help with coaching topics.`;

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

    // Authenticate before spending anything. getUser() was called below only
    // to personalise the prompt — no user meant an empty context block and the
    // request went to the paid gateway anyway. With verify_jwt off, that made
    // this an unauthenticated endpoint spending LOVABLE_API_KEY, which is what
    // supabase/config.toml claimed it was not.
    //
    // The platform gate alone would not be enough even when enabled: the
    // publishable anon key is a validly-signed JWT and ships in the client
    // bundle, so verify_jwt accepts it. Only getUser() proves a real session.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const { messages, includeSquadContext } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Counted after the shape of the request is known to be valid, so a
    // malformed body does not consume a coach's daily allowance.
    const { data: allowed, error: quotaError } = await supabase
      .rpc("claim_ai_call", { p_function_name: "coach-assistant", p_daily_limit: DAILY_CALL_LIMIT });

    if (quotaError) {
      console.error("quota check failed", quotaError);
      return new Response(JSON.stringify({ error: "Could not verify your daily allowance" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: `Daily limit of ${DAILY_CALL_LIMIT} assistant messages reached. Try again tomorrow.` }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Identity is already established above; this only adds club context.
    let coachBlock = "";
    {
      const { data: cd } = await supabase
        .from("coach_details")
        .select("current_club, team, coach_role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cd) {
        const parts: string[] = [];
        if (cd.coach_role) parts.push(`Role: ${cd.coach_role}`);
        if (cd.current_club) parts.push(`Club: ${cd.current_club}`);
        if (cd.team) parts.push(`Age group: ${cd.team}`);
        if (parts.length > 0) {
          coachBlock = `\n\nCOACH PROFILE — always use this to calibrate your responses. Match the language, drill complexity, and tactical depth to this coach's age group:\n${parts.join("\n")}`;
        }
      }
    }

    // Build squad context if requested
    let contextBlock = "";
    if (includeSquadContext && user) {
      const { data: squad } = await supabase
        .from("squad_players")
        .select("id, player_name, position, age, shirt_number")
        .eq("coach_user_id", user.id)
        .limit(50);

      if (squad && squad.length > 0) {
        // Recent assessments (last 30 days) — average per player per category
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: assessments } = await supabase
          .from("coach_assessments")
          .select("squad_player_id, technical, tactical, attitude, work_rate, physical")
          .eq("coach_user_id", user.id)
          .gte("created_at", since);

        const byPlayer: Record<string, { count: number; technical: number; tactical: number; attitude: number; work_rate: number; physical: number }> = {};
        (assessments || []).forEach((a: any) => {
          const k = a.squad_player_id;
          byPlayer[k] = byPlayer[k] || { count: 0, technical: 0, tactical: 0, attitude: 0, work_rate: 0, physical: 0 };
          byPlayer[k].count += 1;
          byPlayer[k].technical += a.technical;
          byPlayer[k].tactical += a.tactical;
          byPlayer[k].attitude += a.attitude;
          byPlayer[k].work_rate += a.work_rate;
          byPlayer[k].physical += a.physical;
        });

        const lines = squad.map((p: any) => {
          const agg = byPlayer[p.id];
          if (!agg) return `- ${p.player_name} (${p.position || "—"}, age ${p.age ?? "—"}): no recent assessments`;
          const avg = (n: number) => (n / agg.count).toFixed(1);
          return `- ${p.player_name} (${p.position || "—"}, age ${p.age ?? "—"}): tech ${avg(agg.technical)}, tact ${avg(agg.tactical)}, att ${avg(agg.attitude)}, work ${avg(agg.work_rate)}, phys ${avg(agg.physical)} (last 30d, n=${agg.count})`;
        });

        contextBlock = `\n\nSquad snapshot (use only if relevant to the coach's question):\n${lines.join("\n")}`;
      }
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT + coachBlock + contextBlock },
          ...messages,
        ],
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached, please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in your Lovable workspace." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(aiResp.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("coach-assistant error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
