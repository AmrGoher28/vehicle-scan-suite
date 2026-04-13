import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Printer, Shield, MessageCircle } from "lucide-react";

interface Vehicle {
  id: string;
  make: string;
  model: string;
  colour: string;
  plate_number: string;
  photo_url: string | null;
}

interface Inspection {
  id: string;
  inspection_date: string;
  inspection_type: string;
  status: string;
  created_at: string;
  vehicle_id: string;
}

interface DamageItem {
  id: string;
  damage_type: string;
  location_on_car: string;
  size_estimate: string | null;
  severity: string;
  confidence_score: number | null;
  repair_cost_estimate_aed: number | null;
  description: string | null;
  photo_position: number | null;
  status: string;
  detected_by_model: string | null;
}

interface Photo {
  id: string;
  position_number: number;
  position_name: string;
  photo_url: string;
}

const severityOrder: Record<string, number> = { severe: 0, moderate: 1, minor: 2 };

const severityBadge = (severity: string) => {
  switch (severity) {
    case "severe":
      return "bg-red-100 text-red-800 border-red-300";
    case "moderate":
      return "bg-amber-100 text-amber-800 border-amber-300";
    default:
      return "bg-emerald-100 text-emerald-800 border-emerald-300";
  }
};

const severityDotColor = (severity: string) => {
  switch (severity) {
    case "severe": return "#ef4444";
    case "moderate": return "#f59e0b";
    default: return "#22c55e";
  }
};

// Map location_on_car text to approximate x,y on SVG (0-200 coord system, centred at 100,100)
const locationToCoords = (location: string): { x: number; y: number } => {
  const l = location.toLowerCase();
  // Front
  if (l.includes("front") && l.includes("left")) return { x: 65, y: 35 };
  if (l.includes("front") && l.includes("right")) return { x: 135, y: 35 };
  if (l.includes("front") && (l.includes("bumper") || l.includes("centre") || l.includes("center") || l.includes("grille") || l.includes("hood") || l.includes("bonnet")))
    return { x: 100, y: 25 };
  if (l.includes("front")) return { x: 100, y: 30 };
  // Rear
  if (l.includes("rear") && l.includes("left")) return { x: 65, y: 165 };
  if (l.includes("rear") && l.includes("right")) return { x: 135, y: 165 };
  if (l.includes("rear") && (l.includes("bumper") || l.includes("centre") || l.includes("center") || l.includes("boot") || l.includes("trunk")))
    return { x: 100, y: 175 };
  if (l.includes("rear")) return { x: 100, y: 170 };
  // Sides
  if (l.includes("left") && (l.includes("door") || l.includes("side") || l.includes("sill") || l.includes("panel") || l.includes("mirror")))
    return { x: 55, y: 100 };
  if (l.includes("right") && (l.includes("door") || l.includes("side") || l.includes("sill") || l.includes("panel") || l.includes("mirror")))
    return { x: 145, y: 100 };
  if (l.includes("left")) return { x: 60, y: 100 };
  if (l.includes("right")) return { x: 140, y: 100 };
  // Roof / top
  if (l.includes("roof") || l.includes("top")) return { x: 100, y: 100 };
  // Wheels
  if (l.includes("wheel") && l.includes("front") && l.includes("left")) return { x: 55, y: 55 };
  if (l.includes("wheel") && l.includes("front") && l.includes("right")) return { x: 145, y: 55 };
  if (l.includes("wheel") && l.includes("rear") && l.includes("left")) return { x: 55, y: 145 };
  if (l.includes("wheel") && l.includes("rear") && l.includes("right")) return { x: 145, y: 145 };
  if (l.includes("alloy") || l.includes("wheel")) return { x: 55, y: 55 };
  // Windshield
  if (l.includes("windshield") || l.includes("windscreen")) return { x: 100, y: 45 };
  // Default centre
  return { x: 100, y: 100 };
};

const InspectionReport = () => {
  const { inspectionId } = useParams<{ inspectionId: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [damageItems, setDamageItems] = useState<DamageItem[]>([]);
  const [loading, setLoading] = useState(true);

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

  const whatsappText = encodeURIComponent(
    `Vehicle Inspection Report for ${vehicle.plate_number} - ${inspection.inspection_date} - ${damageItems.length} items found. View report: ${window.location.href}`
  );

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Action buttons — hidden when printing */}
      <div className="print:hidden sticky top-0 z-50 bg-white border-b border-gray-200 px-6 py-3">
        <div className="mx-auto max-w-4xl flex items-center gap-3">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate(`/vehicle/${vehicle.id}`)}>
            <ArrowLeft className="h-4 w-4" /> Back to Inspection
          </Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" className="gap-2" onClick={() => window.open(`https://wa.me/?text=${whatsappText}`, "_blank")}>
            <MessageCircle className="h-4 w-4" /> Share via WhatsApp
          </Button>
          <Button size="sm" className="gap-2" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print Report
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-8 py-10 space-y-10 print:px-0 print:py-4 print:space-y-6">
        {/* HEADER */}
        <header className="flex items-start justify-between border-b-2 border-gray-900 pb-6">
          <div className="flex items-center gap-3">
            <Shield className="h-10 w-10 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight">FleetScan</h1>
              <p className="text-sm text-gray-500">Vehicle Inspection Report</p>
            </div>
          </div>
          <div className="text-right text-sm text-gray-600 space-y-0.5">
            <p><span className="font-medium text-gray-900">Report Ref:</span> {refNumber}</p>
            <p><span className="font-medium text-gray-900">Generated:</span> {generatedAt}</p>
          </div>
        </header>

        {/* VEHICLE DETAILS */}
        <section className="border border-gray-200 rounded-lg p-6 flex gap-6">
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
            <p><span className="font-medium">Plate Number:</span> {vehicle.plate_number}</p>
            <p><span className="font-medium">Inspection Type:</span> <span className="capitalize">{inspection.inspection_type.replace("-", " ")}</span></p>
            <p><span className="font-medium">Inspector:</span> {user?.email ?? "N/A"}</p>
            <p><span className="font-medium">Date:</span> {new Date(inspection.inspection_date).toLocaleDateString()}</p>
            <p><span className="font-medium">Status:</span> <span className="capitalize">{inspection.status.replace("_", " ")}</span></p>
          </div>
        </section>

        {/* PHOTO GRID */}
        {photos.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3 border-b border-gray-200 pb-2">Inspection Photos</h2>
            <div className="grid grid-cols-4 gap-3">
              {photos.map((p) => (
                <div key={p.id} className="space-y-1">
                  <div className="aspect-video rounded overflow-hidden bg-gray-100">
                    <img src={p.photo_url} alt={p.position_name} className="w-full h-full object-cover" />
                  </div>
                  <p className="text-xs text-gray-500 text-center">{p.position_number}. {p.position_name}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* DAMAGE SUMMARY */}
        <section>
          <h2 className="text-lg font-semibold mb-3 border-b border-gray-200 pb-2">Damage Summary</h2>

          {/* Stats bar */}
          <div className="grid grid-cols-5 gap-3 mb-5">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold">{damageItems.length}</p>
              <p className="text-xs text-gray-500">Total Items</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-emerald-700">{countBySeverity("minor")}</p>
              <p className="text-xs text-emerald-600">Minor</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-700">{countBySeverity("moderate")}</p>
              <p className="text-xs text-amber-600">Moderate</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-red-700">{countBySeverity("severe")}</p>
              <p className="text-xs text-red-600">Severe</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-700">{totalCost.toLocaleString()}</p>
              <p className="text-xs text-blue-600">Est. Cost (AED)</p>
            </div>
          </div>

          {/* Table */}
          {damageItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-gray-200">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border-b border-gray-200 px-3 py-2 text-left font-medium">#</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-left font-medium">Type</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-left font-medium">Location</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-left font-medium">Severity</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-left font-medium">Size</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right font-medium">Conf %</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right font-medium">Cost (AED)</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-left font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {damageItems.map((d, i) => (
                    <tr key={d.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-2">{i + 1}</td>
                      <td className="px-3 py-2 capitalize">{d.damage_type}</td>
                      <td className="px-3 py-2">{d.location_on_car}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full border capitalize ${severityBadge(d.severity)}`}>
                          {d.severity}
                        </span>
                      </td>
                      <td className="px-3 py-2">{d.size_estimate || "—"}</td>
                      <td className="px-3 py-2 text-right">{d.confidence_score ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{d.repair_cost_estimate_aed ? Number(d.repair_cost_estimate_aed).toLocaleString() : "—"}</td>
                      <td className="px-3 py-2 text-gray-600 max-w-[200px] truncate">{d.description || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">No damage items recorded for this inspection.</p>
          )}
        </section>

        {/* VEHICLE DAMAGE MAP */}
        {damageItems.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3 border-b border-gray-200 pb-2">Vehicle Damage Map</h2>
            <div className="flex justify-center">
              <svg viewBox="0 0 200 200" className="w-72 h-72" xmlns="http://www.w3.org/2000/svg">
                {/* Car body */}
                <g transform="translate(100,100)">
                  <path
                    d="M-28,-70 C-28,-70 -35,-55 -35,-40 L-35,45 C-35,55 -30,65 -25,70 L25,70 C30,65 35,55 35,45 L35,-40 C35,-55 28,-70 28,-70 L-28,-70 Z"
                    fill="#f9fafb" stroke="#6b7280" strokeWidth="1.5"
                  />
                  <path d="M-24,-58 C-24,-58 -20,-45 -20,-40 L20,-40 C20,-45 24,-58 24,-58 Z" fill="none" stroke="#9ca3af" strokeWidth="1" />
                  <path d="M-22,45 C-22,50 -18,58 -18,58 L18,58 C18,58 22,50 22,45 Z" fill="none" stroke="#9ca3af" strokeWidth="1" />
                  <rect x="-40" y="-45" width="8" height="18" rx="3" fill="#d1d5db" />
                  <rect x="32" y="-45" width="8" height="18" rx="3" fill="#d1d5db" />
                  <rect x="-40" y="28" width="8" height="18" rx="3" fill="#d1d5db" />
                  <rect x="32" y="28" width="8" height="18" rx="3" fill="#d1d5db" />
                </g>
                <text x="100" y="12" textAnchor="middle" fontSize="7" fill="#6b7280">FRONT</text>
                <text x="100" y="198" textAnchor="middle" fontSize="7" fill="#6b7280">REAR</text>

                {/* Damage dots */}
                {damageItems.map((d, i) => {
                  const coords = locationToCoords(d.location_on_car);
                  // Jitter to avoid overlapping
                  const jx = coords.x + (i % 3 - 1) * 5;
                  const jy = coords.y + (Math.floor(i / 3) % 3 - 1) * 5;
                  return (
                    <g key={d.id}>
                      <circle cx={jx} cy={jy} r="5" fill={severityDotColor(d.severity)} opacity="0.85" stroke="#fff" strokeWidth="1" />
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

        {/* FOOTER */}
        <footer className="border-t-2 border-gray-900 pt-6 space-y-6 mt-10">
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
