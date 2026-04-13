import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer, Shield, MessageCircle, ClipboardList, Loader2 } from "lucide-react";

/* ─── Types ─── */
interface Vehicle {
  id: string; make: string; model: string; colour: string;
  plate_number: string; photo_url: string | null;
}
interface Inspection {
  id: string; inspection_date: string; inspection_type: string;
  status: string; created_at: string; vehicle_id: string;
}
interface DamageItem {
  id: string; damage_type: string; location_on_car: string;
  size_estimate: string | null; severity: string;
  confidence_score: number | null; repair_cost_estimate_aed: number | null;
  description: string | null; photo_position: number | null;
  status: string; detected_by_model: string | null;
  damage_x_percent: number | null; damage_y_percent: number | null;
  bbox_ymin: number | null; bbox_xmin: number | null;
  bbox_ymax: number | null; bbox_xmax: number | null;
}
interface Photo {
  id: string; position_number: number; position_name: string; photo_url: string;
}

/* ─── Helpers ─── */
const severityOrder: Record<string, number> = { severe: 0, moderate: 1, minor: 2 };

const severityColors = (s: string) => {
  if (s === "severe") return { bg: "bg-red-100", text: "text-red-800", border: "border-red-300", dot: "#ef4444", ring: "ring-red-400", stroke: "#ef4444" };
  if (s === "moderate") return { bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-300", dot: "#f59e0b", ring: "ring-amber-400", stroke: "#f59e0b" };
  return { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-300", dot: "#22c55e", ring: "ring-emerald-400", stroke: "#22c55e" };
};

/** Map location text → approximate x,y % on a photo */
const locationToPhotoXY = (loc: string): { x: number; y: number } => {
  const l = loc.toLowerCase();
  let y = 50;
  if (l.includes("lower") || l.includes("bottom") || l.includes("sill") || l.includes("wheel") || l.includes("alloy") || l.includes("tyre") || l.includes("tire")) y = 80;
  else if (l.includes("upper") || l.includes("top") || l.includes("roof")) y = 15;
  else if (l.includes("bumper") && (l.includes("front") || l.includes("rear"))) y = 30;
  else if (l.includes("hood") || l.includes("bonnet") || l.includes("trunk") || l.includes("boot")) y = 25;
  else if (l.includes("windshield") || l.includes("windscreen")) y = 20;
  else if (l.includes("door") || l.includes("panel") || l.includes("mirror")) y = 45;
  let x = 50;
  if (l.includes("left")) x = 25;
  else if (l.includes("right")) x = 75;
  if (l.includes("centre") || l.includes("center")) x = 50;
  return { x, y };
};

/**
 * Convert a DamageItem's bounding box (0-1000) to CSS percentages.
 * Falls back to legacy damage_x/y_percent → small box, then text heuristic.
 */
function getBoundingBoxPercent(item: DamageItem): {
  left: number; top: number; width: number; height: number; hasPreciseBox: boolean;
} {
  if (item.bbox_ymin != null && item.bbox_xmin != null && item.bbox_ymax != null && item.bbox_xmax != null) {
    return {
      left: item.bbox_xmin / 10,
      top: item.bbox_ymin / 10,
      width: (item.bbox_xmax - item.bbox_xmin) / 10,
      height: (item.bbox_ymax - item.bbox_ymin) / 10,
      hasPreciseBox: true,
    };
  }
  if (item.damage_x_percent != null && item.damage_y_percent != null) {
    const pad = 3;
    return {
      left: Math.max(0, item.damage_x_percent - pad),
      top: Math.max(0, item.damage_y_percent - pad),
      width: pad * 2, height: pad * 2, hasPreciseBox: false,
    };
  }
  const fallback = locationToPhotoXY(item.location_on_car);
  return { left: Math.max(0, fallback.x - 3), top: Math.max(0, fallback.y - 3), width: 6, height: 6, hasPreciseBox: false };
}

const inferPhotoPosition = (location: string): number => {
  const l = location.toLowerCase();
  const hasLeft = l.includes("left"); const hasRight = l.includes("right");
  const hasFront = l.includes("front") || l.includes("bonnet") || l.includes("hood") || l.includes("windshield") || l.includes("windscreen") || l.includes("grille") || l.includes("headlight");
  const hasRear = l.includes("rear") || l.includes("boot") || l.includes("trunk") || l.includes("tail") || l.includes("exhaust");
  if (hasFront && hasLeft) return 2; if (hasFront && hasRight) return 8;
  if (hasFront) return 1; if (hasRear && hasLeft) return 4;
  if (hasRear && hasRight) return 6; if (hasRear) return 5;
  if (hasLeft) return 3; if (hasRight) return 7; return 1;
};

const locationToCoords = (location: string): { x: number; y: number } => {
  const l = location.toLowerCase();
  if (l.includes("front") && l.includes("left")) return { x: 65, y: 35 };
  if (l.includes("front") && l.includes("right")) return { x: 135, y: 35 };
  if (l.includes("front") && (l.includes("bumper") || l.includes("centre") || l.includes("center") || l.includes("grille") || l.includes("hood") || l.includes("bonnet"))) return { x: 100, y: 25 };
  if (l.includes("front")) return { x: 100, y: 30 };
  if (l.includes("rear") && l.includes("left")) return { x: 65, y: 165 };
  if (l.includes("rear") && l.includes("right")) return { x: 135, y: 165 };
  if (l.includes("rear") && (l.includes("bumper") || l.includes("centre") || l.includes("center") || l.includes("boot") || l.includes("trunk"))) return { x: 100, y: 175 };
  if (l.includes("rear")) return { x: 100, y: 170 };
  if (l.includes("left") && (l.includes("door") || l.includes("side") || l.includes("sill") || l.includes("panel") || l.includes("mirror"))) return { x: 55, y: 100 };
  if (l.includes("right") && (l.includes("door") || l.includes("side") || l.includes("sill") || l.includes("panel") || l.includes("mirror"))) return { x: 145, y: 100 };
  if (l.includes("left")) return { x: 60, y: 100 };
  if (l.includes("right")) return { x: 140, y: 100 };
  if (l.includes("roof") || l.includes("top")) return { x: 100, y: 100 };
  if (l.includes("wheel") || l.includes("alloy")) return { x: 55, y: 55 };
  if (l.includes("windshield") || l.includes("windscreen")) return { x: 100, y: 45 };
  return { x: 100, y: 100 };
};

/* ─── Sub-components ─── */

const DamageBoundingBox = ({ item, index }: { item: DamageItem; index: number }) => {
  const [showTip, setShowTip] = useState(false);
  const box = getBoundingBoxPercent(item);
  const col = severityColors(item.severity);

  return (
    <div
      className="absolute z-10 cursor-pointer"
      style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
      onClick={() => setShowTip(!showTip)}
    >
      {/* Bounding box rectangle */}
      <div
        className="w-full h-full rounded-sm"
        style={{
          border: `2px solid ${col.stroke}`,
          animation: "pulseGlow 2s ease-in-out infinite",
          backgroundColor: `${col.stroke}15`,
        }}
      />

      {/* Number label */}
      <div
        className="absolute -top-2 -left-2 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
        style={{ backgroundColor: col.stroke }}
      >
        {index + 1}
      </div>

      {/* Imprecise indicator */}
      {!box.hasPreciseBox && (
        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[7px] text-gray-500 bg-white/80 px-1 rounded">
          approx
        </div>
      )}

      {/* Tooltip */}
      {showTip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-gray-900 text-white text-xs rounded-lg p-2 shadow-lg z-50 pointer-events-none">
          <p className="font-semibold capitalize">{item.damage_type}</p>
          <p className="capitalize">{item.severity} — {item.location_on_car}</p>
          {item.size_estimate && <p>Size: {item.size_estimate}</p>}
          {item.description && <p className="mt-1 opacity-80">{item.description}</p>}
          {item.confidence_score != null && <p>Confidence: {item.confidence_score}%</p>}
        </div>
      )}
    </div>
  );
};

const DamageCard = ({ item, index, photo }: { item: DamageItem; index: number; photo?: Photo }) => {
  const col = severityColors(item.severity);
  const box = getBoundingBoxPercent(item);
  const centerX = box.left + box.width / 2;
  const centerY = box.top + box.height / 2;

  return (
    <div className="flex items-stretch gap-0 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {photo && (
        <div className="flex flex-shrink-0">
          {/* Main annotated photo */}
          <div className="relative w-[250px] h-[180px] bg-gray-100">
            <img src={photo.photo_url} alt={photo.position_name} className="w-full h-full object-cover" />
            {/* Bounding box rectangle */}
            <div
              className="absolute rounded-sm pointer-events-none"
              style={{
                left: `${box.left}%`, top: `${box.top}%`,
                width: `${box.width}%`, height: `${box.height}%`,
                border: `2px solid ${col.stroke}`,
                animation: "pulseGlow 2s ease-in-out infinite",
                backgroundColor: `${col.stroke}15`,
              }}
            />
            {/* Number badge */}
            <div
              className="absolute w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white pointer-events-none"
              style={{
                left: `${box.left}%`, top: `${box.top}%`,
                transform: "translate(-50%, -50%)",
                backgroundColor: col.stroke,
              }}
            >
              {index + 1}
            </div>
            {/* Connecting line */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 250 180" preserveAspectRatio="none">
              <line
                x1={centerX * 2.5} y1={centerY * 1.8}
                x2={250} y2={90}
                stroke={col.stroke} strokeWidth="1" strokeDasharray="4,3" opacity="0.6"
              />
            </svg>
          </div>
          {/* Zoomed detail panel */}
          <div className="relative w-[150px] h-[180px] border-l-2 border-red-300 flex-shrink-0">
            <div className="absolute top-0 left-0 right-0 bg-red-500 text-white text-[9px] font-bold text-center py-0.5 z-10 tracking-wider">
              DETAIL
            </div>
            <div
              className="w-full h-full"
              style={{
                backgroundImage: `url(${photo.photo_url})`,
                backgroundSize: "300%",
                backgroundPosition: `${centerX}% ${centerY}%`,
                backgroundRepeat: "no-repeat",
              }}
            />
          </div>
        </div>
      )}

      {/* Severity badge */}
      <div className={`flex flex-col items-center justify-center px-3 py-2 ${col.bg}`}>
        <span className={`text-lg font-bold ${col.text}`}>#{index + 1}</span>
        <span className={`text-[10px] font-semibold uppercase ${col.text} mt-0.5 px-2 py-0.5 rounded-full border ${col.border} ${col.bg}`}>
          {item.severity}
        </span>
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0 p-4">
        <p className="font-semibold text-gray-900 capitalize text-base">{item.damage_type}</p>
        <p className="text-sm text-gray-500 mt-0.5">
          {item.location_on_car}{item.size_estimate ? ` · ${item.size_estimate}` : ""}
        </p>
        {item.description && <p className="text-sm text-gray-600 mt-1.5 line-clamp-2">{item.description}</p>}
        <div className="flex items-center gap-2 mt-1">
          {item.confidence_score != null && (
            <p className="text-xs text-gray-400">Confidence: {item.confidence_score}%</p>
          )}
          {item.bbox_ymin != null ? (
            <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">Precise location</span>
          ) : (
            <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Approximate location</span>
          )}
        </div>
      </div>

      {/* Cost */}
      <div className="flex flex-col items-end justify-center text-right shrink-0 p-4">
        <p className="text-lg font-bold text-gray-900">
          {item.repair_cost_estimate_aed ? `${Number(item.repair_cost_estimate_aed).toLocaleString()}` : "—"}
        </p>
        <p className="text-xs text-gray-400">AED</p>
      </div>
    </div>
  );
};

/* ─── Main component ─── */
const InspectionReport = () => {
  const { inspectionId } = useParams<{ inspectionId: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [damageItems, setDamageItems] = useState<DamageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user || !inspectionId) return;
    const load = async () => {
      const { data: insp } = await supabase.from("inspections").select("*").eq("id", inspectionId).single();
      if (!insp) { setLoading(false); return; }
      setInspection(insp);

      const [vRes, pRes, dRes] = await Promise.all([
        supabase.from("vehicles").select("*").eq("id", insp.vehicle_id).single(),
        supabase.from("inspection_photos").select("*").eq("inspection_id", inspectionId).order("position_number", { ascending: true }),
        supabase.from("damage_items").select("*").eq("inspection_id", inspectionId),
      ]);
      if (vRes.data) setVehicle(vRes.data);
      if (pRes.data) setPhotos(pRes.data);
      if (dRes.data) {
        const sorted = [...dRes.data].sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));
        setDamageItems(sorted);
      }
      setLoading(false);
    };
    load();
  }, [user, inspectionId]);

  useEffect(() => {
    if (damageItems.length === 0 || summary !== null) return;
    const fetchSummary = async () => {
      setSummaryLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("generate-summary", {
          body: { damage_items: damageItems },
        });
        if (!error && data?.summary) setSummary(data.summary);
        else setSummary("Unable to generate summary at this time.");
      } catch {
        setSummary("Unable to generate summary at this time.");
      } finally {
        setSummaryLoading(false);
      }
    };
    fetchSummary();
  }, [damageItems, summary]);

  if (authLoading || loading) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-muted-foreground">Loading report...</p></div>;
  }
  if (!inspection || !vehicle) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-muted-foreground">Report not found</p></div>;
  }

  const refNumber = inspection.id.slice(0, 8).toUpperCase();
  const generatedAt = new Date().toLocaleString();
  const totalCost = damageItems.reduce((s, d) => s + (d.repair_cost_estimate_aed ? Number(d.repair_cost_estimate_aed) : 0), 0);
  const countBySeverity = (sev: string) => damageItems.filter((d) => d.severity === sev).length;
  const priorityItems = damageItems.filter((d) => d.severity === "severe" || d.severity === "moderate");
  const preciseCount = damageItems.filter((d) => d.bbox_ymin != null).length;

  const whatsappText = encodeURIComponent(
    `Vehicle Inspection Report for ${vehicle.plate_number} - ${inspection.inspection_date} - ${damageItems.length} items found. View report: ${window.location.href}`
  );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Pulse animation for bounding boxes */}
      <style>{`
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.85; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* Action buttons */}
      <div className="print:hidden sticky top-0 z-50 bg-white border-b border-gray-200 px-6 py-3 shadow-sm">
        <div className="mx-auto max-w-4xl flex items-center gap-3">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate(`/vehicle/${vehicle.id}`)}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" className="gap-2" onClick={() => window.open(`https://wa.me/?text=${whatsappText}`, "_blank")}>
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </Button>
          <Button size="sm" className="gap-2" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-8 py-10 space-y-12 print:px-0 print:py-4 print:space-y-6 print:bg-white">
        {/* ── HEADER ── */}
        <header className="flex items-start justify-between border-b-2 border-gray-900 pb-6">
          <div className="flex items-center gap-3">
            <Shield className="h-10 w-10 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight">FleetScan</h1>
              <p className="text-sm text-gray-500">Vehicle Inspection Report</p>
            </div>
          </div>
          <div className="text-right text-sm text-gray-600 space-y-0.5">
            <p><span className="font-medium text-gray-900">Ref:</span> {refNumber}</p>
            <p><span className="font-medium text-gray-900">Generated:</span> {generatedAt}</p>
          </div>
        </header>

        {/* ── VEHICLE DETAILS ── */}
        <section className="border border-gray-200 rounded-xl bg-white p-6 flex gap-6 shadow-sm">
          <div className="w-32 h-20 rounded-md overflow-hidden bg-gray-100 flex-shrink-0">
            {vehicle.photo_url ? (
              <img src={vehicle.photo_url} alt={`${vehicle.make} ${vehicle.model}`} className="w-full h-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400 text-xs">No photo</div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-10 gap-y-1.5 text-sm flex-1">
            <p><span className="font-medium">Make:</span> {vehicle.make}</p>
            <p><span className="font-medium">Model:</span> {vehicle.model}</p>
            <p><span className="font-medium">Colour:</span> {vehicle.colour}</p>
            <p><span className="font-medium">Plate:</span> {vehicle.plate_number}</p>
            <p><span className="font-medium">Type:</span> <span className="capitalize">{inspection.inspection_type.replace("-", " ")}</span></p>
            <p><span className="font-medium">Inspector:</span> {user?.email ?? "N/A"}</p>
            <p><span className="font-medium">Date:</span> {new Date(inspection.inspection_date).toLocaleDateString()}</p>
            <p><span className="font-medium">Status:</span> <span className="capitalize">{inspection.status.replace("_", " ")}</span></p>
          </div>
        </section>

        {/* ── EXECUTIVE SUMMARY ── */}
        <section>
          <h2 className="text-xl font-bold mb-4">Inspection Summary</h2>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 flex gap-4">
            <ClipboardList className="h-6 w-6 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900 leading-relaxed">
              {summaryLoading ? (
                <span className="flex items-center gap-2 text-blue-600"><Loader2 className="h-4 w-4 animate-spin" /> Generating AI summary…</span>
              ) : (
                summary || "No damage items to summarise."
              )}
            </div>
          </div>
          {damageItems.length > 0 && (
            <p className="text-xs text-gray-400 mt-2">
              {preciseCount} of {damageItems.length} damage item(s) have precise bounding box locations.
              {preciseCount < damageItems.length && ` ${damageItems.length - preciseCount} use approximate positioning.`}
            </p>
          )}
        </section>

        <hr className="border-gray-200" />

        {/* ── ANNOTATED PHOTO GRID ── */}
        {photos.length > 0 && (
          <section>
            <h2 className="text-xl font-bold mb-4">Inspection Photos</h2>
            <div className="grid grid-cols-4 gap-4 print:grid-cols-4">
              {photos.map((p) => {
                const matchingDamage = damageItems.filter(
                  (d) =>
                    d.photo_position === p.position_number ||
                    (!d.photo_position && inferPhotoPosition(d.location_on_car) === p.position_number)
                );
                return (
                  <div key={p.id} className="space-y-1.5">
                    <div className="relative aspect-video rounded-lg overflow-hidden bg-gray-100 shadow-sm">
                      <img src={p.photo_url} alt={p.position_name} className="w-full h-full object-cover" />
                      {matchingDamage.map((d) => {
                        const globalIdx = damageItems.indexOf(d);
                        return <DamageBoundingBox key={d.id} item={d} index={globalIdx} />;
                      })}
                    </div>
                    <p className="text-xs text-gray-500 text-center font-medium">
                      {p.position_number}. {p.position_name}
                      {matchingDamage.length > 0 && (
                        <span className="text-red-500 ml-1">({matchingDamage.length} found)</span>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <hr className="border-gray-200" />

        {/* ── DAMAGE SUMMARY STATS ── */}
        <section>
          <h2 className="text-xl font-bold mb-4">Damage Summary</h2>
          <div className="grid grid-cols-5 gap-3 mb-6">
            <div className="bg-white rounded-xl p-4 text-center border border-gray-200 shadow-sm">
              <p className="text-2xl font-bold">{damageItems.length}</p>
              <p className="text-xs text-gray-500">Total Items</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-4 text-center border border-emerald-200">
              <p className="text-2xl font-bold text-emerald-700">{countBySeverity("minor")}</p>
              <p className="text-xs text-emerald-600">Minor</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 text-center border border-amber-200">
              <p className="text-2xl font-bold text-amber-700">{countBySeverity("moderate")}</p>
              <p className="text-xs text-amber-600">Moderate</p>
            </div>
            <div className="bg-red-50 rounded-xl p-4 text-center border border-red-200">
              <p className="text-2xl font-bold text-red-700">{countBySeverity("severe")}</p>
              <p className="text-xs text-red-600">Severe</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-4 text-center border border-blue-200">
              <p className="text-2xl font-bold text-blue-700">{totalCost.toLocaleString()}</p>
              <p className="text-xs text-blue-600">Est. Cost (AED)</p>
            </div>
          </div>

          {/* ── PRIORITY ITEMS ── */}
          {priorityItems.length > 0 && (
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-red-800 mb-3">⚠ Priority Items Requiring Immediate Attention</h3>
              <div className="space-y-3">
                {priorityItems.slice(0, 3).map((item) => {
                  const idx = damageItems.indexOf(item);
                  const col = severityColors(item.severity);
                  return (
                    <div key={item.id} className="flex items-stretch gap-4 rounded-xl border-l-4 border-red-500 bg-red-50 p-5 shadow-sm">
                      <div className={`flex flex-col items-center justify-center rounded-lg px-3 py-2 ${col.bg}`}>
                        <span className={`text-xl font-bold ${col.text}`}>#{idx + 1}</span>
                        <span className={`text-[10px] font-semibold uppercase ${col.text}`}>{item.severity}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-900 capitalize text-lg">{item.damage_type}</p>
                        <p className="text-sm text-gray-600 mt-0.5">{item.location_on_car}{item.size_estimate ? ` · ${item.size_estimate}` : ""}</p>
                        {item.description && <p className="text-sm text-gray-700 mt-1.5">{item.description}</p>}
                      </div>
                      <div className="flex flex-col items-end justify-center shrink-0">
                        <p className="text-xl font-bold text-red-700">
                          {item.repair_cost_estimate_aed ? `${Number(item.repair_cost_estimate_aed).toLocaleString()} AED` : "—"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <hr className="border-gray-200 mb-6" />

          {/* ── ALL DAMAGE CARDS ── */}
          {damageItems.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold mb-2">All Damage Items</h3>
              {damageItems.map((d, i) => (
                <DamageCard key={d.id} item={d} index={i} photo={
                  photos.find(p => p.position_number === d.photo_position) ||
                  photos.find(p => p.position_number === inferPhotoPosition(d.location_on_car))
                } />
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">No damage items recorded for this inspection.</p>
          )}
        </section>

        <hr className="border-gray-200" />

        {/* ── VEHICLE DAMAGE MAP ── */}
        {damageItems.length > 0 && (
          <section>
            <h2 className="text-xl font-bold mb-4">Vehicle Damage Map</h2>
            <div className="flex justify-center">
              <svg viewBox="0 0 200 200" className="w-72 h-72" xmlns="http://www.w3.org/2000/svg">
                <g transform="translate(100,100)">
                  <path d="M-28,-70 C-28,-70 -35,-55 -35,-40 L-35,45 C-35,55 -30,65 -25,70 L25,70 C30,65 35,55 35,45 L35,-40 C35,-55 28,-70 28,-70 L-28,-70 Z" fill="#f9fafb" stroke="#6b7280" strokeWidth="1.5" />
                  <path d="M-24,-58 C-24,-58 -20,-45 -20,-40 L20,-40 C20,-45 24,-58 24,-58 Z" fill="none" stroke="#9ca3af" strokeWidth="1" />
                  <path d="M-22,45 C-22,50 -18,58 -18,58 L18,58 C18,58 22,50 22,45 Z" fill="none" stroke="#9ca3af" strokeWidth="1" />
                  <rect x="-40" y="-45" width="8" height="18" rx="3" fill="#d1d5db" />
                  <rect x="32" y="-45" width="8" height="18" rx="3" fill="#d1d5db" />
                  <rect x="-40" y="28" width="8" height="18" rx="3" fill="#d1d5db" />
                  <rect x="32" y="28" width="8" height="18" rx="3" fill="#d1d5db" />
                </g>
                <text x="100" y="12" textAnchor="middle" fontSize="7" fill="#6b7280">FRONT</text>
                <text x="100" y="198" textAnchor="middle" fontSize="7" fill="#6b7280">REAR</text>
                {damageItems.map((d, i) => {
                  const coords = locationToCoords(d.location_on_car);
                  const jx = coords.x + (i % 3 - 1) * 5;
                  const jy = coords.y + (Math.floor(i / 3) % 3 - 1) * 5;
                  return (
                    <g key={d.id}>
                      <circle cx={jx} cy={jy} r="5" fill={severityColors(d.severity).dot} opacity="0.85" stroke="#fff" strokeWidth="1" />
                      <text x={jx} y={jy + 1} textAnchor="middle" dominantBaseline="central" fontSize="5" fill="#fff" fontWeight="bold">{i + 1}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="flex justify-center gap-6 mt-2 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-emerald-500" /> Minor</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-amber-500" /> Moderate</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-red-500" /> Severe</span>
            </div>
          </section>
        )}

        <hr className="border-gray-200" />

        {/* ── FOOTER ── */}
        <footer className="border-t-2 border-gray-900 pt-6 space-y-6">
          <div>
            <h3 className="text-sm font-semibold mb-4">Customer Acknowledgement</h3>
            <div className="grid grid-cols-2 gap-12">
              <div>
                <div className="border-b border-gray-400 mb-1 h-10" />
                <p className="text-xs text-gray-500">Signature</p>
              </div>
              <div>
                <div className="border-b border-gray-400 mb-1 h-10" />
                <p className="text-xs text-gray-500">Printed Name</p>
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-400 italic">
            This report was generated using AI-assisted damage detection. All findings should be verified by a qualified assessor.
          </p>
        </footer>
      </div>
    </div>
  );
};

export default InspectionReport;
