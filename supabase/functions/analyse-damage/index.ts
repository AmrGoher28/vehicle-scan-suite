import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-pro";
const MAX_EXECUTION_TIME = 120000;
const BATCH_SIZE = 2;

/* ─── Bounding box helpers ─── */

/** Parse a [ymin, xmin, ymax, xmax] array (0-1000). Returns null if invalid. */
function parseBoundingBox(
  arr: unknown
): { ymin: number; xmin: number; ymax: number; xmax: number } | null {
  if (!Array.isArray(arr) || arr.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = arr.map(Number);
  if ([ymin, xmin, ymax, xmax].some((v) => isNaN(v) || v < 0 || v > 1000))
    return null;
  if (ymax < ymin || xmax < xmin) return null;
  return { ymin, xmin, ymax, xmax };
}

/** Convert legacy damage_x/y_percent (0-100) → small bbox (0-1000). */
function legacyPointToBox(
  xPct: number | null | undefined,
  yPct: number | null | undefined
): { ymin: number; xmin: number; ymax: number; xmax: number } | null {
  if (xPct == null || yPct == null) return null;
  const cx = Math.round(xPct * 10);
  const cy = Math.round(yPct * 10);
  const pad = 30;
  return {
    ymin: Math.max(0, cy - pad),
    xmin: Math.max(0, cx - pad),
    ymax: Math.min(1000, cy + pad),
    xmax: Math.min(1000, cx + pad),
  };
}

/* ─── Prompts ─── */

const FIRST_PASS_SYSTEM = `You are an expert vehicle damage assessor for a luxury supercar rental company inspecting vehicles worth £50,000 to £500,000. Your job is to identify any damage that could have been caused during a rental period. Flag anything that goes beyond normal day-to-day wear. ALWAYS flag these — even if minor: any scratch longer than 2cm or deeper than surface level, any dent regardless of size, any scuff or scrape mark on bumpers bodywork or side skirts, alloy wheel kerb rash or rim damage, cracked chipped or starred windscreen or glass, bumper scrapes dents or cracks, broken cracked or scuffed wing mirrors, panel damage creases or misalignment, damaged or missing trim badges or body parts, tyre sidewall cuts bulges or punctures, interior rips tears burns or stains, any paint damage where bare metal or primer is visible. USE YOUR JUDGEMENT on these — flag only if they look abnormal or excessive: light surface scratches under 2cm (only flag if clustered or clearly from one incident), minor chips on leading edges (only flag if large or numerous in one area). IGNORE these completely — they are normal wear: isolated tiny stone chips on bonnet or bumper, swirl marks from washing, water spots or water etching, paint oxidation or sun fade, dust or dirt, factory paint imperfections, normal tyre tread wear. For each piece of damage found return a JSON array of objects with fields: type, location_on_car, size_estimate, severity (minor/moderate/severe), confidence_score (0-100), description, bounding_box (an array of 4 integers [ymin, xmin, ymax, xmax] on a 0-1000 coordinate scale where [0,0,1000,1000] is the full image — pinpoint a tight box around the visible damage). Study the image carefully and pinpoint exactly where the damage appears in the photo. Be thorough but fair. When in doubt, flag it — it is better to flag something and have a human dismiss it than to miss genuine damage. Return ONLY valid JSON.`;

const SECOND_PASS_SYSTEM = `You are a senior vehicle damage assessor reviewing findings on a luxury rental vehicle. Review each item and: 1) Confirm genuine damage that a customer could have caused. 2) Reject anything that is clearly just normal wear and tear like isolated stone chips or wash swirls. 3) Flag anything the first inspector missed — look carefully at wheel arches, lower bumpers, door edges, and mirror housings as these are commonly missed. 4) Add repair cost estimates in AED. 5) For borderline items, keep them but downgrade to minor severity rather than rejecting them. 6) Preserve the bounding_box values from the first pass for each item, and add them for any new items you flag. Return a final JSON array with fields: type, location_on_car, size_estimate, severity, confidence_score, repair_cost_estimate_aed, description, bounding_box, status (confirmed/new/rejected). Return ONLY valid JSON.`;

async function analyzePhoto(photo: any, apiKey: string): Promise<any[]> {
  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: FIRST_PASS_SYSTEM },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyse this photo from position ${photo.position_number} (${photo.position_name}) of the vehicle.`,
            },
            { type: "image_url", image_url: { url: photo.photo_url } },
          ],
        },
      ],
    }),
  });

  if (response.status === 429) {
    console.log(`Rate limited on position ${photo.position_number}, waiting 5s...`);
    await new Promise((r) => setTimeout(r, 5000));
    return [];
  }
  if (!response.ok) {
    const text = await response.text();
    console.error(`Model error for position ${photo.position_number}: ${response.status}`, text);
    return [];
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content || "[]";
  const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    const items = JSON.parse(cleaned);
    if (Array.isArray(items)) {
      return items.map((item: any) => ({
        ...item,
        photo_position: photo.position_number,
      }));
    }
  } catch {
    console.error(`Failed to parse response for position ${photo.position_number}`);
  }
  return [];
}

async function processDamageAnalysis(inspectionId: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; }, MAX_EXECUTION_TIME);

  try {
    await supabaseAdmin.from("inspections").update({ status: "processing" }).eq("id", inspectionId);

    const { data: photos, error: photosErr } = await supabaseAdmin
      .from("inspection_photos")
      .select("*")
      .eq("inspection_id", inspectionId)
      .order("position_number", { ascending: true });

    if (photosErr || !photos?.length) {
      await supabaseAdmin.from("inspections").update({ status: "failed" }).eq("id", inspectionId);
      console.error("No photos found:", photosErr);
      return;
    }

    // ===== FIRST PASS: Parallel batches =====
    console.log("Starting first pass (parallel batches of 2)...");
    const allFirstPassDamage: any[] = [];

    for (let i = 0; i < photos.length; i += BATCH_SIZE) {
      if (timedOut) { console.log("Timeout reached during first pass"); break; }
      const batch = photos.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map((photo) => analyzePhoto(photo, LOVABLE_API_KEY)));
      for (const r of results) {
        if (r.status === "fulfilled") allFirstPassDamage.push(...r.value);
        else console.error("Batch item failed:", r.reason);
      }
      if (i + BATCH_SIZE < photos.length) await new Promise((r) => setTimeout(r, 1000));
    }

    console.log(`First pass found ${allFirstPassDamage.length} damage items`);

    // ===== SECOND PASS =====
    let finalDamageItems: any[] = [];

    if (!timedOut) {
      console.log("Starting second pass...");
      try {
        const imageBlocks = photos.map((p) => [
          { type: "text", text: `Position ${p.position_number} (${p.position_name}):` },
          { type: "image_url", image_url: { url: p.photo_url } },
        ]).flat();

        const secondPassResponse = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: "system", content: SECOND_PASS_SYSTEM },
              {
                role: "user",
                content: [
                  ...imageBlocks,
                  {
                    type: "text",
                    text: `\n\nInitial damage report:\n${JSON.stringify(allFirstPassDamage, null, 2)}\n\nPlease review and provide your final assessment.`,
                  },
                ],
              },
            ],
          }),
        });

        if (secondPassResponse.ok) {
          const secondResult = await secondPassResponse.json();
          const secondContent = secondResult.choices?.[0]?.message?.content || "[]";
          const secondCleaned = secondContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          try {
            const reviewed = JSON.parse(secondCleaned);
            if (Array.isArray(reviewed)) {
              finalDamageItems = reviewed.map((item: any) => ({
                ...item,
                detected_by_model: item.status === "new" ? "gemini-second" : "gemini-dual",
              }));
            }
          } catch {
            console.error("Failed to parse second pass response");
          }
        } else {
          const t = await secondPassResponse.text();
          console.error("Second pass error:", secondPassResponse.status, t);
        }
      } catch (e) {
        console.error("Second pass error:", e);
      }
    }

    // Fallback to first pass
    if (finalDamageItems.length === 0 && allFirstPassDamage.length > 0) {
      finalDamageItems = allFirstPassDamage.map((item) => ({
        ...item,
        status: "confirmed",
        detected_by_model: "gemini-first",
      }));
    }

    const confirmedItems = finalDamageItems.filter((item) => item.status !== "rejected");

    if (confirmedItems.length > 0) {
      const rows = confirmedItems.map((item) => {
        // Try to parse bounding_box array first, fall back to legacy point
        const bbox = parseBoundingBox(item.bounding_box) || legacyPointToBox(item.damage_x_percent, item.damage_y_percent);

        // Compute legacy x/y percent from bbox center for backwards compatibility
        let dxPct: number | null = item.damage_x_percent ?? null;
        let dyPct: number | null = item.damage_y_percent ?? null;
        if (bbox && dxPct == null) {
          dxPct = Math.round((bbox.xmin + bbox.xmax) / 2) / 10;
          dyPct = Math.round((bbox.ymin + bbox.ymax) / 2) / 10;
        }

        return {
          inspection_id: inspectionId,
          photo_position: item.photo_position || null,
          damage_type: item.type || "unknown",
          location_on_car: item.location_on_car || "unknown",
          size_estimate: item.size_estimate || null,
          severity: item.severity || "minor",
          confidence_score: item.confidence_score || null,
          repair_cost_estimate_aed: item.repair_cost_estimate_aed || null,
          description: item.description || null,
          detected_by_model: item.detected_by_model || "gemini",
          status: item.status || "confirmed",
          damage_x_percent: dxPct,
          damage_y_percent: dyPct,
          bbox_ymin: bbox?.ymin ?? null,
          bbox_xmin: bbox?.xmin ?? null,
          bbox_ymax: bbox?.ymax ?? null,
          bbox_xmax: bbox?.xmax ?? null,
        };
      });

      const { error: insertErr } = await supabaseAdmin.from("damage_items").insert(rows);
      if (insertErr) console.error("Error saving damage items:", insertErr);
    }

    const newStatus = timedOut ? "partial" : confirmedItems.length > 0 ? "needs_repair" : "passed";
    await supabaseAdmin.from("inspections").update({ status: newStatus }).eq("id", inspectionId);
    console.log(`Analysis complete: ${confirmedItems.length} items, status: ${newStatus}`);
  } catch (e) {
    console.error("processDamageAnalysis error:", e);
    await supabaseAdmin.from("inspections").update({ status: "failed" }).eq("id", inspectionId);
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req) => {
  console.log("Edge function started");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
    if (!anonKey) throw new Error("Missing anon/publishable key");

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader! } },
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { inspection_id } = body;
    if (!inspection_id) {
      return new Response(JSON.stringify({ error: "inspection_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inspection, error: inspectionError } = await supabaseUser
      .from("inspections")
      .select("id")
      .eq("id", inspection_id)
      .maybeSingle();

    if (inspectionError) throw inspectionError;
    if (!inspection) {
      return new Response(JSON.stringify({ error: "Inspection not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { count: photoCount, error: photoCountError } = await supabaseUser
      .from("inspection_photos")
      .select("id", { count: "exact", head: true })
      .eq("inspection_id", inspection_id);

    if (photoCountError) throw photoCountError;
    if (!photoCount) {
      return new Response(JSON.stringify({ error: "Inspection has no photos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // @ts-ignore EdgeRuntime is available in Supabase Edge Functions
    EdgeRuntime.waitUntil(processDamageAnalysis(inspection_id));

    return new Response(JSON.stringify({ message: "Analysis started", inspection_id }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyse-damage error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
