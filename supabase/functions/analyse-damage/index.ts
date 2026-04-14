import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL      = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL            = "google/gemini-2.5-pro";
const MAX_EXECUTION_TIME = 240000;
const BATCH_SIZE       = 4;

// ─── Photo type classification ─────────────────────────────────────────────

type PhotoCategory = "overview" | "detail" | "wheel";

function classifyPhoto(photo: { position_name?: string }): PhotoCategory {
  const name = (photo.position_name || "").toLowerCase();
  if (name.startsWith("wheel"))  return "wheel";
  if (name.startsWith("detail")) return "detail";
  if (name.startsWith("manual damage")) return "detail";
  return "overview";
}

// ─── System prompts ────────────────────────────────────────────────────────

const FIRST_PASS_SYSTEM = `You are an expert vehicle damage assessor for a luxury supercar rental company inspecting vehicles worth £50,000 to £500,000.
Your job is to identify any damage that could have been caused during a rental period.
Flag anything that goes beyond normal day-to-day wear.

ALWAYS flag these — even if minor:
- Any scratch longer than 2cm or deeper than surface level
- Any dent regardless of size
- Any scuff or scrape mark on bumpers, bodywork, or side skirts
- Alloy wheel kerb rash or rim damage
- Cracked, chipped, or starred windscreen or glass
- Bumper scrapes, dents, or cracks
- Broken, cracked, or scuffed wing mirrors
- Panel damage, creases, or misalignment
- Damaged or missing trim, badges, or body parts
- Tyre sidewall cuts, bulges, or punctures
- Interior rips, tears, burns, or stains
- Any paint damage where bare metal or primer is visible

USE YOUR JUDGEMENT on these — flag only if abnormal or excessive:
- Light surface scratches under 2cm (only if clustered or clearly from one incident)
- Minor chips on leading edges (only if large or numerous in one area)

IGNORE these completely — they are normal wear:
- Isolated tiny stone chips on bonnet or bumper
- Swirl marks from washing
- Water spots or water etching
- Paint oxidation or sun fade
- Dust or dirt
- Factory paint imperfections
- Normal tyre tread wear

CRITICAL LOCALIZATION INSTRUCTIONS:
For each piece of damage, you MUST provide a precise bounding box showing exactly where the damage appears in the photo.
The bounding box format is [ymin, xmin, ymax, xmax] where each value is an integer from 0 to 1000:
- 0 means the very top-left of the image
- 1000 means the very bottom-right of the image
- The box should TIGHTLY enclose ONLY the damaged area, not a large region
- For a small scratch, the box might be something like [450, 300, 480, 500] — narrow and precise
- For a larger dent, the box would be wider but still only covering the dent itself

For each piece of damage found, return a JSON array of objects with these fields:
- type: string (e.g. "scratch", "dent", "scuff", "kerb rash")
- location_on_car: string (e.g. "front left bumper", "rear right quarter panel")
- size_estimate: string (e.g. "approximately 5cm", "small")
- severity: "minor" | "moderate" | "severe"
- confidence_score: number 0-100
- description: string (detailed description of the damage)
- bounding_box: [ymin, xmin, ymax, xmax] — integers 0-1000, tightly enclosing the damage in the photo

Study the image carefully. Look at every region of the photo methodically — top-left, top-right, center, bottom-left, bottom-right.
Be thorough but fair. When in doubt, flag it.
Return ONLY valid JSON — no markdown, no explanation.
If no damage is found, return an empty array: []`;

const SECOND_PASS_SYSTEM = `You are a senior vehicle damage assessor reviewing findings from a multi-photo vehicle inspection on a luxury rental vehicle.

CRITICAL: CROSS-PHOTO DUPLICATE DETECTION
Many photos may show the SAME damage from slightly different angles or distances.
You MUST merge duplicates into a single item:
- If two or more items from different photos describe damage in the same location_on_car with the same type, merge them into ONE item.
- For the merged item, keep the bounding_box and photo_position from the photo where the damage is MOST clearly visible (highest confidence, best angle, sharpest image).
- Combine descriptions if they add unique detail.
- Use the highest confidence_score from the duplicates.
- Add a "seen_in_frames" field listing all photo numbers where this damage appeared.
- If close-up photos exist and show the same damage as wider shots, prefer the close-up's bounding_box (it's likely clearer).

Review each item and:
1) Confirm genuine damage that a customer could have caused.
2) Reject anything that is clearly just normal wear and tear (isolated stone chips, wash swirls).
3) Flag anything the first inspector missed — look carefully at wheel arches, lower bumpers, door edges, and mirror housings as these are commonly missed.
4) Add repair cost estimates in AED.
5) For borderline items, keep them but downgrade to minor severity rather than rejecting.

BOUNDING BOX AND POSITION RULES:
- Every item MUST include a "bounding_box" field as [ymin, xmin, ymax, xmax] (integers 0-1000).
- For confirmed items, preserve the bounding_box from the best photo — do NOT change it unless merging.
- For NEW items you discover, provide your own bounding_box that tightly encloses the damage in the relevant photo.
- Every item MUST include "photo_position" (integer) indicating which photo it appears in.

Return a final JSON array with fields:
- type, location_on_car, size_estimate, severity, confidence_score
- repair_cost_estimate_aed: number
- description: string
- bounding_box: [ymin, xmin, ymax, xmax]
- photo_position: integer (photo number with the clearest view of this damage)
- seen_in_frames: integer[] (all photo numbers where this damage was detected)
- status: "confirmed" | "new" | "rejected"

Return ONLY valid JSON — no markdown, no explanation.`;

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseBoundingBox(bbox: unknown): { bbox_ymin: number | null; bbox_xmin: number | null; bbox_ymax: number | null; bbox_xmax: number | null } {
  if (Array.isArray(bbox) && bbox.length === 4) {
    let [ymin, xmin, ymax, xmax] = bbox.map(Number);
    if ([ymin, xmin, ymax, xmax].every(v => !isNaN(v) && v >= 0 && v <= 1000)) {
      if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
      if (xmin > xmax) [xmin, xmax] = [xmax, xmin];
      if (ymax - ymin < 5) ymax = Math.min(1000, ymin + 20);
      if (xmax - xmin < 5) xmax = Math.min(1000, xmin + 20);
      return { bbox_ymin: ymin, bbox_xmin: xmin, bbox_ymax: ymax, bbox_xmax: xmax };
    }
  }
  return { bbox_ymin: null, bbox_xmin: null, bbox_ymax: null, bbox_xmax: null };
}

function normaliseKey(type: string, location: string): string {
  const clean = (s: string) =>
    s.toLowerCase()
      .replace(/\b(the|a|an|on|in|at|of|with|near|around|along)\b/g, "")
      .replace(/[-_]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return `${clean(type)}::${clean(location)}`;
}

function preMergeDuplicates(items: Record<string, unknown>[]): Record<string, unknown>[] {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const key = normaliseKey(String(item.type ?? ""), String(item.location_on_car ?? ""));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  const merged: Record<string, unknown>[] = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      merged.push({ ...group[0], seen_in_frames: [group[0].photo_position] });
    } else {
      group.sort((a, b) => (Number(b.confidence_score) || 0) - (Number(a.confidence_score) || 0));
      const best = group[0];
      const detailItem = group.find(g => {
        const cat = classifyPhoto({ position_name: String(g.photo_name ?? "") });
        return cat === "detail" || cat === "wheel";
      });
      const primary = detailItem ?? best;
      merged.push({
        ...primary,
        confidence_score: best.confidence_score,
        seen_in_frames: group.map(g => g.photo_position),
        description: `${String(best.description ?? "")}${group.length > 1 ? ` (visible in ${group.length} photos)` : ""}`,
      });
    }
  }
  return merged;
}

// ─── Per-photo first-pass analysis ────────────────────────────────────────

async function analyzePhoto(photo: Record<string, unknown>, apiKey: string): Promise<Record<string, unknown>[]> {
  const category = classifyPhoto({ position_name: String(photo.position_name ?? "") });

  const contextHint = category === "detail"
    ? `This is a CLOSE-UP photo of a body panel: "${photo.position_name}". Because this is close-up, you should be able to detect even small scratches, scuffs, and fine surface damage. Look extremely carefully at every part of the image.`
    : category === "wheel"
    ? `This is a CLOSE-UP photo of a wheel: "${photo.position_name}". Inspect the rim for kerb rash, the spokes for scratches, and the tyre for sidewall damage. Even light kerb rash on a luxury alloy can cost 500-1500 AED to repair — flag it.`
    : `This is photo "${photo.position_name}" from a vehicle inspection. Scan every region of the image for any damage — scratches, dents, scuffs, panel misalignment, broken lights, bumper damage, wheel damage, trim damage — anything beyond normal wear.`;

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: FIRST_PASS_SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: `${contextHint}\n\nProvide precise bounding boxes for every damage item you find.` },
            { type: "image_url", image_url: { url: photo.photo_url } },
          ],
        },
      ],
    }),
  });

  if (response.status === 429) {
    console.log(`Rate limited on photo ${photo.position_number}, retrying in 5s…`);
    await new Promise(r => setTimeout(r, 5000));
    return analyzePhoto(photo, apiKey);
  }
  if (!response.ok) {
    console.error(`Model error for photo ${photo.position_number}: ${response.status}`);
    return [];
  }

  const result  = await response.json();
  const content = result.choices?.[0]?.message?.content || "[]";
  const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    const items = JSON.parse(cleaned);
    if (Array.isArray(items)) {
      return items.map((item: Record<string, unknown>) => ({
        ...item,
        bounding_box: item.bounding_box ?? null,
        photo_position: photo.position_number,
        photo_name:     photo.position_name,
        photo_category: category,
      }));
    }
  } catch {
    console.error(`Failed to parse response for photo ${photo.position_number}`);
  }
  return [];
}

// ─── Main processing ───────────────────────────────────────────────────────

async function processDamageAnalysis(inspectionId: string) {
  const LOVABLE_API_KEY    = Deno.env.get("LOVABLE_API_KEY")!;
  const supabaseUrl        = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin              = createClient(supabaseUrl, supabaseServiceKey);

  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; }, MAX_EXECUTION_TIME);

  try {
    await admin.from("inspections").update({ status: "processing" }).eq("id", inspectionId);

    const { data: photos, error: photosErr } = await admin
      .from("inspection_photos")
      .select("*")
      .eq("inspection_id", inspectionId)
      .order("position_number", { ascending: true });

    if (photosErr || !photos?.length) {
      await admin.from("inspections").update({ status: "failed" }).eq("id", inspectionId);
      console.error("No photos found:", photosErr);
      return;
    }

    const detailPhotos   = photos.filter(p => classifyPhoto(p) !== "overview");
    const overviewPhotos = photos.filter(p => classifyPhoto(p) === "overview");
    const orderedPhotos  = [...detailPhotos, ...overviewPhotos];

    console.log(`Processing ${photos.length} photos: ${overviewPhotos.length} overview + ${detailPhotos.length} detail/wheel`);

    // ── First pass ──
    const allFirstPass: Record<string, unknown>[] = [];
    for (let i = 0; i < orderedPhotos.length; i += BATCH_SIZE) {
      if (timedOut) { console.log(`Timeout at photo ${i}`); break; }
      const batch   = orderedPhotos.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(p => analyzePhoto(p as Record<string, unknown>, LOVABLE_API_KEY)));
      for (const r of results) {
        if (r.status === "fulfilled") allFirstPass.push(...r.value);
        else console.error("Batch item failed:", r.reason);
      }
      if (i + BATCH_SIZE < orderedPhotos.length) await new Promise(r => setTimeout(r, 800));
    }

    console.log(`First pass: ${allFirstPass.length} raw detections`);
    const preMerged = preMergeDuplicates(allFirstPass);
    console.log(`Pre-merged: ${preMerged.length} unique items`);

    // ── Second pass ──
    let finalItems: Record<string, unknown>[] = [];

    if (!timedOut) {
      try {
        const framesWithDamage = new Set(allFirstPass.map(d => d.photo_position));
        const reviewSet = new Set<number>();
        for (const p of photos) {
          if (classifyPhoto(p) !== "overview" || framesWithDamage.has(p.position_number)) {
            reviewSet.add(p.position_number);
          }
        }
        for (const p of overviewPhotos) {
          if (reviewSet.size >= 16) break;
          reviewSet.add(p.position_number);
        }
        const reviewPhotos = photos
          .filter(p => reviewSet.has(p.position_number))
          .sort((a, b) => a.position_number - b.position_number);

        console.log(`Second pass: reviewing ${reviewPhotos.length} photos`);

        const imageBlocks = reviewPhotos.flatMap(p => [
          { type: "text", text: `Photo ${p.position_number}: "${p.position_name}"` },
          { type: "image_url", image_url: { url: p.photo_url } },
        ]);

        const secondResp = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
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
                    text: `\n\nFirst-pass report (${allFirstPass.length} raw detections → ${preMerged.length} pre-merged items):\n${JSON.stringify(preMerged, null, 2)}\n\nTotal photos: ${photos.length} (${overviewPhotos.length} overview + ${detailPhotos.length} detail/wheel).\n\nFinalise the damage report. Every item MUST have bounding_box, photo_position, and seen_in_frames.`,
                  },
                ],
              },
            ],
          }),
        });

        if (secondResp.ok) {
          const secondResult  = await secondResp.json();
          const secondContent = secondResult.choices?.[0]?.message?.content || "[]";
          const secondCleaned = secondContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          try {
            const reviewed = JSON.parse(secondCleaned);
            if (Array.isArray(reviewed)) {
              finalItems = reviewed.map((item: Record<string, unknown>) => ({
                ...item,
                detected_by_model: item.status === "new" ? "gemini-second" : "gemini-dual",
              }));
            }
          } catch { console.error("Second pass parse failed"); }
        } else {
          console.error("Second pass error:", secondResp.status, await secondResp.text());
        }
      } catch (e) { console.error("Second pass exception:", e); }
    }

    if (finalItems.length === 0 && preMerged.length > 0) {
      console.log("Second pass empty — using pre-merged first pass");
      finalItems = preMerged.map(item => ({ ...item, status: "confirmed", detected_by_model: "gemini-first" }));
    }

    // ── Filter out low-confidence rejects ──
    const confirmed = finalItems.filter(item => item.status !== "rejected");
    const lowConfidence = confirmed.filter(item => Number(item.confidence_score) < 35);
    const highConfidence = confirmed.filter(item => Number(item.confidence_score) >= 35);

    if (lowConfidence.length > 0) {
      console.log(`Flagging ${lowConfidence.length} low-confidence items for human review`);
    }

    // ── Persist to database ──
    const allToSave = [
      ...highConfidence,
      ...lowConfidence.map(item => ({ ...item, status: "needs_review" })),
    ];

    if (allToSave.length > 0) {
      const rows = allToSave.map(item => {
        const { bbox_ymin, bbox_xmin, bbox_ymax, bbox_xmax } = parseBoundingBox(item.bounding_box);
        return {
          inspection_id:            inspectionId,
          photo_position:           item.photo_position ?? null,
          damage_type:              item.type ?? "unknown",
          location_on_car:          item.location_on_car ?? "unknown",
          size_estimate:            item.size_estimate ?? null,
          severity:                 item.severity ?? "minor",
          confidence_score:         item.confidence_score ?? null,
          repair_cost_estimate_aed: item.repair_cost_estimate_aed ?? null,
          description:              item.description ?? null,
          detected_by_model:        item.detected_by_model ?? "gemini",
          status:                   item.status ?? "confirmed",
          bbox_ymin,  bbox_xmin,  bbox_ymax,  bbox_xmax,
          damage_x_percent: bbox_xmin !== null ? Math.round(((bbox_xmin + bbox_xmax!) / 2) / 10) : null,
          damage_y_percent: bbox_ymin !== null ? Math.round(((bbox_ymin + bbox_ymax!) / 2) / 10) : null,
        };
      });

      const { error: insertErr } = await admin.from("damage_items").insert(rows);
      if (insertErr) console.error("Error saving items:", insertErr);
      else console.log(`Saved ${rows.length} damage items (${highConfidence.length} confirmed, ${lowConfidence.length} needs review)`);
    }

    const status = timedOut
      ? "partial"
      : highConfidence.length > 0
      ? "needs_repair"
      : "passed";

    await admin.from("inspections").update({ status }).eq("id", inspectionId);
    console.log(`Analysis complete: ${confirmed.length} items, status: ${status}`);
  } catch (e) {
    console.error("processDamageAnalysis error:", e);
    await admin.from("inspections").update({ status: "failed" }).eq("id", inspectionId);
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Edge function handler ─────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch { return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

    const authHeader  = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
    if (!anonKey) throw new Error("Missing anon key");

    const supabaseUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader! } } });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { inspection_id } = body as { inspection_id?: string };
    if (!inspection_id) return new Response(JSON.stringify({ error: "inspection_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: inspection, error: inspErr } = await supabaseUser.from("inspections").select("id").eq("id", inspection_id).maybeSingle();
    if (inspErr) throw inspErr;
    if (!inspection) return new Response(JSON.stringify({ error: "Inspection not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { count: photoCount, error: countErr } = await supabaseUser.from("inspection_photos").select("id", { count: "exact", head: true }).eq("inspection_id", inspection_id);
    if (countErr) throw countErr;
    if (!photoCount) return new Response(JSON.stringify({ error: "No photos found" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // @ts-ignore
    EdgeRuntime.waitUntil(processDamageAnalysis(inspection_id));

    return new Response(
      JSON.stringify({ message: "Analysis started", inspection_id, photo_count: photoCount }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("handler error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
