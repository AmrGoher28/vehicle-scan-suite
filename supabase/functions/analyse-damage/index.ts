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
  if (name.startsWith("wheel"))   return "wheel";
  if (name.startsWith("detail"))  return "detail";
  return "overview";
}

// ─── System prompts per photo category ────────────────────────────────────

const BASE_RULES = `
ALWAYS flag these — even if minor:
- Any scratch longer than 2 cm or deeper than surface level
- Any dent regardless of size
- Any scuff or scrape on bumpers, bodywork, or side skirts
- Alloy wheel kerb rash or rim damage
- Cracked, chipped, or starred windscreen or glass
- Bumper scrapes, dents, or cracks
- Broken, cracked, or scuffed wing mirrors
- Panel damage, creases, or misalignment
- Damaged or missing trim, badges, or body parts
- Tyre sidewall cuts, bulges, or punctures
- Interior rips, tears, burns, or stains
- Any paint damage where bare metal or primer is visible

USE YOUR JUDGEMENT — flag only if abnormal:
- Light surface scratches under 2 cm (only if clustered or from one incident)
- Minor chips on leading edges (only if large or numerous)

IGNORE completely — normal wear:
- Isolated tiny stone chips on bonnet/bumper
- Swirl marks from washing
- Water spots or etching
- Paint oxidation or sun fade
- Dust, dirt, factory imperfections
- Normal tyre tread wear

BOUNDING BOX FORMAT: [ymin, xmin, ymax, xmax] — integers 0–1000.
The box must TIGHTLY enclose ONLY the damaged area.
Example — small scratch: [450, 300, 480, 500]
Example — larger dent: [200, 150, 380, 420]

Return ONLY a valid JSON array — no markdown, no explanation.
If no damage: return []

Each item must have:
- type: string
- location_on_car: string
- size_estimate: string
- severity: "minor" | "moderate" | "severe"
- confidence_score: number 0–100
- description: string
- bounding_box: [ymin, xmin, ymax, xmax]
`;

const OVERVIEW_SYSTEM = `You are an expert vehicle damage assessor for a luxury/premium vehicle fleet (rental, buying, and selling).
You are reviewing an OVERVIEW photo taken from 3–4 metres away showing a full angle of the vehicle.

Your job: identify any damage visible at this distance. Focus on:
- Panel alignment and large dents
- Bumper damage and scrapes
- Cracked or broken lights
- Missing or damaged trim/badges
- Obvious paint damage or deep scratches
- Windscreen or glass damage

Note: fine surface scratches may not be visible at this distance — that is expected. Focus on structural and obvious cosmetic damage.
Scan the entire frame methodically — top-left, top-right, centre, bottom-left, bottom-right, wheel arches.

${BASE_RULES}`;

const DETAIL_SYSTEM = `You are an expert vehicle damage assessor reviewing a CLOSE-UP DETAIL photo of a vehicle's body panels.
This photo was taken at 40–60 cm from the surface and shows a specific panel: bumper, door, or sill.

Your job: find fine surface damage that may not be visible in overview shots. Scrutinise:
- Paint surface for fine scratches, swirls from impact, keying, or scuffs
- Panel edges for door dings, creases, or impact damage
- Lower sills and rocker panels for kerb strikes and road debris damage
- Bumper surfaces for paint transfer, scrapes, stress cracks, or clips
- Any discolouration indicating a previous repair or respray

Because this is a close-up, you can detect damage down to 1–2 cm. Be thorough but fair.
Study every region of the photo at high resolution — zoom into corners and edges mentally.

${BASE_RULES}`;

const WHEEL_SYSTEM = `You are an expert vehicle damage assessor reviewing a CLOSE-UP WHEEL PHOTO.
This photo was taken at 30–50 cm from the wheel showing the rim face and tyre.

Your job: inspect every part of the wheel for damage. Check:
- Alloy rim: kerb rash (scuffing on the outer lip), deep gouges, bent or cracked sections
- Spoke faces: scratches, scuffs, or impact marks
- Centre cap: cracks, missing caps, logo damage
- Tyre: sidewall cuts, bulges, unusual wear patterns, embedded objects, cracking
- Wheel arch liner: cracks, missing clips, or stone damage (if visible)

Even light kerb rash on a luxury rim can cost 500–1500 AED to repair — flag it.
Note the specific position (front-left, rear-right, etc.) from the photo label if provided.

${BASE_RULES}`;

const SECOND_PASS_SYSTEM = `You are a senior vehicle damage assessor doing a final review of an 18-photo 3-stage vehicle scan.
The scan has three stages:
- "Overview - ..." photos: 8 wide-angle shots around the vehicle
- "Detail - ..." photos: 6 close-up shots of panels, bumpers, and sills
- "Wheel - ..." photos: 4 close-up wheel shots

CRITICAL — CROSS-PHOTO DUPLICATE DETECTION:
Many overview and detail shots may show the same damage from different angles or distances.
You MUST merge duplicates into a single item:
- Same damage type + same location_on_car from different photos → merge into ONE item
- Keep the bounding_box from the photo where it is MOST clearly visible (highest confidence, closest/sharpest)
- Combine descriptions if they add unique detail; use the highest confidence_score
- Add "seen_in_frames" listing all photo positions where this damage appeared

Review each item and:
1. Confirm genuine rental/purchase-relevant damage
2. Reject items that are clearly normal wear (isolated stone chips, wash swirls)
3. Flag anything the first pass missed — particularly lower bumpers, door edges, mirror housings, tyre sidewalls
4. Assign realistic repair cost estimates in AED:
   - Light kerb rash on alloy:     400–900 AED
   - Deep kerb rash / bend:        800–2000 AED
   - Minor scratch (panel):        200–600 AED
   - Moderate scratch/scuff:       500–1500 AED
   - Small dent (no paint damage): 300–800 AED
   - Dent with paint damage:       800–2500 AED
   - Bumper scrape/crack:          600–2000 AED
   - Windscreen chip:              300–600 AED
   - Windscreen crack:             1200–3000 AED
5. For borderline items, keep them as "minor" rather than rejecting

Every confirmed item MUST have:
- bounding_box: [ymin, xmin, ymax, xmax] (0–1000)
- photo_position: integer (the photo number with the clearest view)
- seen_in_frames: integer[] (all photo numbers where this damage appears)
- status: "confirmed" | "new" | "rejected"
- repair_cost_estimate_aed: number

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
  const category  = classifyPhoto({ position_name: String(photo.position_name ?? "") });
  const systemMap = { overview: OVERVIEW_SYSTEM, detail: DETAIL_SYSTEM, wheel: WHEEL_SYSTEM };
  const system    = systemMap[category];

  const contextHint = category === "overview"
    ? `This is an overview shot: "${photo.position_name}". Scan the entire frame for any visible damage.`
    : category === "detail"
    ? `This is a close-up detail shot: "${photo.position_name}". Look very carefully for fine scratches, scuffs, and panel damage.`
    : `This is a wheel close-up: "${photo.position_name}". Inspect the rim, spokes, and tyre thoroughly.`;

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
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
