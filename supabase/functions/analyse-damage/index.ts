import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const FIRST_PASS_SYSTEM = `You are an expert vehicle damage assessor working for a luxury supercar rental company. You inspect vehicles worth £50,000 to £500,000. Your job is to identify EVERY piece of damage no matter how small. Examine this photo with extreme attention to detail. Look for: scratches (surface, deep, hairline), dents (small, medium, large), scuffs and abrasions, paint chips and stone chips, clear coat damage or swirl marks, kerb rash or damage on alloy wheels, cracked or chipped glass, trim damage or missing parts, discolouration or paint fade, water spots or etching, bumper scrapes, panel gap misalignment. For EACH piece of damage found, return a JSON array of objects with these fields: type, location_on_car, size_estimate, severity (minor/moderate/severe), confidence_score (0-100), description. Be extremely thorough. It is better to flag something questionable than to miss real damage. If no damage is found, return an empty array. Return ONLY valid JSON.`;

const SECOND_PASS_SYSTEM = `You are a senior vehicle damage assessor reviewing a junior inspector's findings on a luxury vehicle. Your job is to: 1) Verify each damage item — confirm or reject it. 2) Check for any damage the initial inspector MISSED. 3) Upgrade or downgrade severity ratings where appropriate. 4) Add repair cost estimates in AED for each confirmed item. Return a final JSON array of all confirmed and newly found damage items with fields: type, location_on_car, size_estimate, severity, confidence_score, repair_cost_estimate_aed, description, status (confirmed/new/rejected). Return ONLY valid JSON.`;

async function processDamageAnalysis(inspectionId: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Mark as processing
    await supabaseAdmin.from("inspections").update({ status: "processing" }).eq("id", inspectionId);

    // Get photos
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

    // ===== FIRST PASS: Gemini =====
    console.log("Starting first pass with Gemini...");
    const allFirstPassDamage: any[] = [];

    for (const photo of photos) {
      try {
        const response = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-pro",
            messages: [
              { role: "system", content: FIRST_PASS_SYSTEM },
              {
                role: "user",
                content: [
                  { type: "text", text: `Analyse this photo from position ${photo.position_number} (${photo.position_name}) of the vehicle.` },
                  { type: "image_url", image_url: { url: photo.photo_url } },
                ],
              },
            ],
          }),
        });

        if (response.status === 429) {
          console.log("Rate limited, waiting 5s...");
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        if (!response.ok) {
          console.error(`Gemini error for position ${photo.position_number}:`, response.status);
          await response.text();
          continue;
        }

        const result = await response.json();
        const content = result.choices?.[0]?.message?.content || "[]";
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

        try {
          const items = JSON.parse(cleaned);
          if (Array.isArray(items)) {
            items.forEach((item: any) => {
              allFirstPassDamage.push({ ...item, photo_position: photo.position_number });
            });
          }
        } catch {
          console.error(`Failed to parse Gemini response for position ${photo.position_number}`);
        }
      } catch (e) {
        console.error(`Error processing position ${photo.position_number}:`, e);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log(`First pass found ${allFirstPassDamage.length} damage items`);

    // ===== SECOND PASS: GPT-5 =====
    console.log("Starting second pass with GPT-5...");
    const photoDescriptions = photos.map((p) => `Position ${p.position_number} (${p.position_name}): ${p.photo_url}`).join("\n");

    let finalDamageItems: any[] = [];

    try {
      const secondPassResponse = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-5",
          messages: [
            { role: "system", content: SECOND_PASS_SYSTEM },
            {
              role: "user",
              content: `Here are 8 photos of the vehicle:\n${photoDescriptions}\n\nHere is the initial damage report from the first inspector:\n${JSON.stringify(allFirstPassDamage, null, 2)}\n\nPlease review and provide your final assessment.`,
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
              detected_by_model: item.status === "new" ? "gpt-5" : "gemini+gpt-5",
            }));
          }
        } catch {
          console.error("Failed to parse GPT-5 response");
        }
      } else {
        console.error("GPT-5 error:", secondPassResponse.status);
        await secondPassResponse.text();
      }
    } catch (e) {
      console.error("Second pass error:", e);
    }

    // Fallback to first pass if second pass failed
    if (finalDamageItems.length === 0 && allFirstPassDamage.length > 0) {
      finalDamageItems = allFirstPassDamage.map((item) => ({
        ...item,
        status: "confirmed",
        detected_by_model: "gemini",
      }));
    }

    const confirmedItems = finalDamageItems.filter((item) => item.status !== "rejected");

    // Save to database
    if (confirmedItems.length > 0) {
      const rows = confirmedItems.map((item) => ({
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
      }));

      const { error: insertErr } = await supabaseAdmin.from("damage_items").insert(rows);
      if (insertErr) console.error("Error saving damage items:", insertErr);
    }

    // Update inspection status
    const newStatus = confirmedItems.length > 0 ? "needs_repair" : "passed";
    await supabaseAdmin.from("inspections").update({ status: newStatus }).eq("id", inspectionId);
    console.log(`Analysis complete: ${confirmedItems.length} confirmed items, status: ${newStatus}`);
  } catch (e) {
    console.error("processDamageAnalysis error:", e);
    await supabaseAdmin.from("inspections").update({ status: "failed" }).eq("id", inspectionId);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { inspection_id } = await req.json();
    if (!inspection_id) {
      return new Response(JSON.stringify({ error: "inspection_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Start background processing
    // @ts-ignore EdgeRuntime is available in Supabase Edge Functions
    EdgeRuntime.waitUntil(processDamageAnalysis(inspection_id));

    return new Response(
      JSON.stringify({ message: "Analysis started", inspection_id }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("analyse-damage error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
