import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-pro";
const MAX_EXECUTION_TIME = 240000;
const BATCH_SIZE = 3;

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

IMPORTANT ABOUT FRAME CONTEXT:
- You may receive auto-extracted frames from a 360° video walkaround. These are sequential frames showing different angles of the vehicle.
- You may also receive manually taken damage photos — close-ups taken by the inspector of specific damage they noticed. These may include a note about what the inspector saw.
- Treat all photos equally — look for damage in every one, but expect manual damage photos to contain more obvious or targeted damage.

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

const SECOND_PASS_SYSTEM = `You are a senior vehicle damage assessor reviewing findings on a luxury rental vehicle.
This inspection used a 360° video walkaround with auto-extracted frames, plus optional manual close-up damage photos taken by the inspector.

CRITICAL: CROSS-FRAME DUPLICATE DETECTION
Many frames may show the SAME damage from slightly different angles or moments in the video.
You MUST merge duplicates into a single item:
- If two or more items from different frames describe damage in the same location_on_car with the same type (e.g. "scratch on front left bumper" appearing in frames 3, 4, and 5), merge them into ONE item.
- For the merged item, keep the bounding_box and photo_position from the frame where the damage is MOST clearly visible (highest confidence, best angle, sharpest image).
- Combine descriptions if they add unique detail.
- Use the highest confidence_score from the duplicates.
- In the merged item, add a "seen_in_frames" field listing all frame numbers where this damage appeared — this increases confidence.
- If manual damage photos exist and show the same damage as auto-frames, prefer the manual photo's bounding_box (it's likely closer/clearer) but note it was also seen in the auto-frames.

Review each item and:
1) Confirm genuine damage that a customer could have caused.
2) Reject anything that is clearly just normal wear and tear (isolated stone chips, wash swirls).
3) Flag anything the first inspector missed — look carefully at wheel arches, lower bumpers, door edges, and mirror housings as these are commonly missed.
4) Add repair cost estimates in AED.
5) For borderline items, keep them but downgrade to minor severity rather than rejecting.

BOUNDING BOX AND POSITION RULES:
- Every item MUST include a "bounding_box" field as [ymin, xmin, ymax, xmax] (integers 0-1000).
- For confirmed items, preserve the bounding_box from the best frame — do NOT change it unless merging.
- For NEW items you discover, provide your own bounding_box that tightly encloses the damage in the relevant photo.
- Every item MUST include "photo_position" (integer) indicating which photo/frame number it appears in.
- The frame numbers correspond to the order photos were uploaded. The names tell you the context:
  - "Auto frame N (Xs)" = auto-extracted from the 360° video at timestamp X seconds
  - "Manual damage N" or "Manual damage N — note" = close-up taken by inspector, possibly with a note

Return a final JSON array with fields:
- type, location_on_car, size_estimate, severity, confidence_score
- repair_cost_estimate_aed: number
- description: string
- bounding_box: [ymin, xmin, ymax, xmax]
- photo_position: integer (frame number with the clearest view of this damage)
- seen_in_frames: integer[] (all frame numbers where this damage was detected)
- is_manual_photo: boolean (true if the best view is from a manual damage photo)
- status: "confirmed" | "new" | "rejected"

Return ONLY valid JSON — no markdown, no explanation.`;

function parseBoundingBox(bbox: any): {
  bbox_ymin: number | null;
  bbox_xmin: number | null;
  bbox_ymax: number | null;
  bbox_xmax: number | null;
} {
  if (Array.isArray(bbox) && bbox.length === 4) {
    const [ymin, xmin, ymax, xmax] = bbox.map(Number);
    if ([ymin, xmin, ymax, xmax].every((v) => !isNaN(v) && v >= 0 && v <= 1000)) {
      return { bbox_ymin: ymin, bbox_xmin: xmin, bbox_ymax: ymax, bbox_xmax: xmax };
    }
  }
  return { bbox_ymin: null, bbox_xmin: null, bbox_ymax: null, bbox_xmax: null };
}

function legacyPointToBox(item: any): number[] | null {
  const x = item.damage_x_percent;
  const y = item.damage_y_percent;
  if (typeof x === "number" && typeof y === "number") {
    const xVal = Math.round(x * 10);
    const yVal = Math.round(y * 10);
    const pad = 30;
    return [
      Math.max(0, yVal - pad),
      Math.max(0, xVal - pad),
      Math.min(1000, yVal + pad),
      Math.min(1000, xVal + pad),
    ];
  }
  return null;
}

function classifyPhoto(photo: any): "auto" | "manual" {
  const name = (photo.position_name || "").toLowerCase();
  if (name.startsWith("manual damage")) return "manual";
  return "auto";
}

async function analyzePhoto(photo: any, apiKey: string): Promise<any[]> {
  const photoType = classifyPhoto(photo);
  const contextHint = photoType === "manual"
    ? `This is a manual damage close-up photo (${photo.position_name}). The inspector specifically took this photo because they noticed damage here. Look very carefully for the damage they intended to capture.`
    : `This is auto-extracted frame ${photo.position_number} from a 360° video walkaround (${photo.position_name}). Scan the entire frame for any damage.`;

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
              text: `${contextHint}\n\nProvide precise bounding boxes for every damage item you find.`,
            },
            { type: "image_url", image_url: { url: photo.photo_url } },
          ],
        },
      ],
    }),
  });

  if (response.status === 429) {
    console.log(`Rate limited on frame ${photo.position_number}, waiting 5s...`);
    await new Promise((r) => setTimeout(r, 5000));
    return analyzePhoto(photo, apiKey);
  }
  if (!response.ok) {
    const text = await response.text();
    console.error(`Model error for frame ${photo.position_number}: ${response.status}`, text);
    return [];
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content || "[]";
  const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    const items = JSON.parse(cleaned);
    if (Array.isArray(items)) {
      return items.map((item: any) => {
        const bbox = item.bounding_box || legacyPointToBox(item);
        return {
          ...item,
          bounding_box: bbox,
          photo_position: photo.position_number,
          photo_type: photoType,
          photo_name: photo.position_name,
        };
      });
    }
  } catch {
    console.error(`Failed to parse response for frame ${photo.position_number}`);
  }
  return [];
}

function preMergeDuplicates(items: any[]): any[] {
  const groups: Map<string, any[]> = new Map();

  for (const item of items) {
    const key = `${(item.type || "").toLowerCase().trim()}::${(item.location_on_car || "").toLowerCase().trim()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const merged: any[] = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      merged.push({
        ...group[0],
        seen_in_frames: [group[0].photo_position],
      });
    } else {
      group.sort((a: any, b: any) => (b.confidence_score || 0) - (a.confidence_score || 0));
      const best = group[0];
      const manualItem = group.find((g: any) => g.photo_type === "manual");
      const primaryItem = manualItem || best;
      merged.push({
        ...primaryItem,
        confidence_score: best.confidence_score,
        seen_in_frames: group.map((g: any) => g.photo_position),
        description: best.description + (group.length > 1
          ? ` (also visible in ${group.length - 1} other frame${group.length > 2 ? "s" : ""})`
          : ""),
      });
    }
  }

  return merged;
}

async function processDamageAnalysis(inspectionId: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
  }, MAX_EXECUTION_TIME);

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

    const totalFrames = photos.length;
    const autoFrames = photos.filter((p) => classifyPhoto(p) === "auto");
    const manualPhotos = photos.filter((p) => classifyPhoto(p) === "manual");
    console.log(`Processing ${totalFrames} frames: ${autoFrames.length} auto + ${manualPhotos.length} manual`);

    const orderedPhotos = [...manualPhotos, ...autoFrames];
    console.log(`Starting first pass (batches of ${BATCH_SIZE})...`);
    const allFirstPassDamage: any[] = [];

    for (let i = 0; i < orderedPhotos.length; i += BATCH_SIZE) {
      if (timedOut) {
        console.log(`Timeout reached after processing ${i} of ${orderedPhotos.length} frames`);
        break;
      }
      const batch = orderedPhotos.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((photo) => analyzePhoto(photo, LOVABLE_API_KEY))
      );
      for (const r of results) {
        if (r.status === "fulfilled") allFirstPassDamage.push(...r.value);
        else console.error("Batch item failed:", r.reason);
      }
      if (i + BATCH_SIZE < orderedPhotos.length) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    console.log(`First pass found ${allFirstPassDamage.length} raw damage items across ${orderedPhotos.length} frames`);

    const preMerged = preMergeDuplicates(allFirstPassDamage);
    console.log(`Pre-merged to ${preMerged.length} unique damage items`);

    let finalDamageItems: any[] = [];

    if (!timedOut) {
      console.log("Starting second pass...");
      try {
        const MAX_AUTO_FRAMES_FOR_REVIEW = 12;
        let reviewAutoFrames = autoFrames;
        if (autoFrames.length > MAX_AUTO_FRAMES_FOR_REVIEW) {
          const step = autoFrames.length / MAX_AUTO_FRAMES_FOR_REVIEW;
          reviewAutoFrames = [];
          for (let i = 0; i < MAX_AUTO_FRAMES_FOR_REVIEW; i++) {
            reviewAutoFrames.push(autoFrames[Math.floor(i * step)]);
          }
        }

        const framesWithDamage = new Set(allFirstPassDamage.map((d) => d.photo_position));
        for (const photo of autoFrames) {
          if (framesWithDamage.has(photo.position_number) && !reviewAutoFrames.includes(photo)) {
            reviewAutoFrames.push(photo);
          }
        }
        reviewAutoFrames.sort((a, b) => a.position_number - b.position_number);

        const reviewPhotos = [...reviewAutoFrames, ...manualPhotos];
        console.log(`Second pass reviewing ${reviewPhotos.length} frames (${reviewAutoFrames.length} auto + ${manualPhotos.length} manual)`);

        const imageBlocks = reviewPhotos
          .map((p) => [
            { type: "text", text: `Frame ${p.position_number}: "${p.position_name}"` },
            { type: "image_url", image_url: { url: p.photo_url } },
          ])
          .flat();

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
                    text: `\n\nPre-merged damage report from first pass (${allFirstPassDamage.length} raw detections merged to ${preMerged.length} items):\n${JSON.stringify(preMerged, null, 2)}\n\nTotal frames in inspection: ${totalFrames} (${autoFrames.length} auto-extracted from video + ${manualPhotos.length} manual close-ups).\n\nPlease review, merge any remaining duplicates, confirm or reject each item, and provide your final assessment. Remember: every item MUST have a bounding_box, photo_position, and seen_in_frames.`,
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
              finalDamageItems = reviewed.map((item: any) => {
                const bbox = item.bounding_box || legacyPointToBox(item);
                return {
                  ...item,
                  bounding_box: bbox,
                  detected_by_model: item.status === "new" ? "gemini-second" : "gemini-dual",
                };
              });
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

    if (finalDamageItems.length === 0 && preMerged.length > 0) {
      console.log("Second pass produced no results, falling back to pre-merged first pass");
      finalDamageItems = preMerged.map((item) => ({
        ...item,
        status: "confirmed",
        detected_by_model: "gemini-first",
      }));
    }

    const confirmedItems = finalDamageItems.filter((item) => item.status !== "rejected");

    if (confirmedItems.length > 0) {
      const rows = confirmedItems.map((item) => {
        const { bbox_ymin, bbox_xmin, bbox_ymax, bbox_xmax } = parseBoundingBox(item.bounding_box);

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
          bbox_ymin,
          bbox_xmin,
          bbox_ymax,
          bbox_xmax,
          damage_x_percent: bbox_xmin !== null ? Math.round(((bbox_xmin + bbox_xmax!) / 2) / 10) : null,
          damage_y_percent: bbox_ymin !== null ? Math.round(((bbox_ymin + bbox_ymax!) / 2) / 10) : null,
        };
      });

      const { error: insertErr } = await supabaseAdmin.from("damage_items").insert(rows);
      if (insertErr) console.error("Error saving damage items:", insertErr);
      else console.log(`Saved ${rows.length} confirmed damage items`);
    }

    const newStatus = timedOut
      ? "partial"
      : confirmedItems.length > 0
      ? "needs_repair"
      : "passed";
    await supabaseAdmin.from("inspections").update({ status: newStatus }).eq("id", inspectionId);
    console.log(`Analysis complete: ${confirmedItems.length} confirmed items, status: ${newStatus}`);
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
    const {
      data: { user },
      error: authError,
    } = await supabaseUser.auth.getUser();
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

    return new Response(JSON.stringify({ message: "Analysis started", inspection_id, photo_count: photoCount }), {
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
