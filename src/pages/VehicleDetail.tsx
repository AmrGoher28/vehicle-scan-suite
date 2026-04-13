import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import InspectionCaptureFlow from "@/components/InspectionCaptureFlow";
import DamageResults from "@/components/DamageResults";
import { ArrowLeft, Car, Camera, Image, Scan, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface Vehicle {
  id: string;
  make: string;
  model: string;
  colour: string;
  plate_number: string;
  photo_url: string | null;
  created_at: string;
}

interface Inspection {
  id: string;
  inspection_date: string;
  inspection_type: string;
  notes: string | null;
  status: string;
  created_at: string;
}

interface InspectionPhoto {
  id: string;
  position_number: number;
  position_name: string;
  photo_url: string;
}

const statusColor = (status: string) => {
  switch (status) {
    case "passed": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "failed": return "bg-red-500/20 text-red-400 border-red-500/30";
    case "needs_repair": return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    default: return "bg-muted text-muted-foreground";
  }
};

const VehicleDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCaptureFlow, setShowCaptureFlow] = useState(false);
  const [inspectionType, setInspectionType] = useState<"check-in" | "check-out">("check-out");
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [viewingPhotos, setViewingPhotos] = useState<InspectionPhoto[] | null>(null);
  const [analysing, setAnalysing] = useState<string | null>(null);
  const [damageResults, setDamageResults] = useState<{ inspectionId: string; items: any[] } | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  const fetchData = async () => {
    if (!id) return;
    const { data: v } = await supabase.from("vehicles").select("*").eq("id", id).single();
    if (v) setVehicle(v);

    const { data: insp } = await supabase
      .from("inspections")
      .select("*")
      .eq("vehicle_id", id)
      .order("inspection_date", { ascending: false });
    if (insp) setInspections(insp);
    setLoading(false);
  };

  useEffect(() => {
    if (user) fetchData();
  }, [user, id]);

  const viewPhotos = async (inspectionId: string) => {
    const { data } = await supabase
      .from("inspection_photos")
      .select("*")
      .eq("inspection_id", inspectionId)
      .order("position_number", { ascending: true });
    if (data) setViewingPhotos(data);
  };

  const viewDamageReport = async (inspectionId: string) => {
    const { data } = await supabase
      .from("damage_items")
      .select("*")
      .eq("inspection_id", inspectionId)
      .order("severity", { ascending: true });
    if (data && data.length > 0) {
      setDamageResults({
        inspectionId,
        items: data.map((d) => ({
          type: d.damage_type,
          location_on_car: d.location_on_car,
          size_estimate: d.size_estimate,
          severity: d.severity,
          confidence_score: d.confidence_score,
          repair_cost_estimate_aed: d.repair_cost_estimate_aed ? Number(d.repair_cost_estimate_aed) : undefined,
          description: d.description,
          status: d.status,
          detected_by_model: d.detected_by_model,
          photo_position: d.photo_position,
        })),
      });
    } else {
      toast({ title: "No damage report", description: "Run an analysis first." });
    }
  };

  const analyseInspection = async (inspectionId: string) => {
    setAnalysing(inspectionId);
    try {
      const { error } = await supabase.functions.invoke("analyse-damage", {
        body: { inspection_id: inspectionId },
      });
      if (error) throw error;

      toast({ title: "Analysis Started", description: "Processing photos with AI. This may take 1-2 minutes..." });

      // Poll for completion
      const poll = async () => {
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const { data: insp } = await supabase
            .from("inspections")
            .select("status")
            .eq("id", inspectionId)
            .single();
          if (!insp) break;
          if (insp.status === "processing" || insp.status === "pending") continue;

          // Done
          if (insp.status === "failed") {
            toast({ title: "Analysis Failed", description: "The AI analysis encountered an error.", variant: "destructive" });
          } else {
            const { data: items } = await supabase
              .from("damage_items")
              .select("*")
              .eq("inspection_id", inspectionId)
              .order("severity", { ascending: true });
            if (items && items.length > 0) {
              toast({ title: "Analysis Complete", description: `Found ${items.length} damage item(s).` });
              setDamageResults({
                inspectionId,
                items: items.map((d) => ({
                  type: d.damage_type,
                  location_on_car: d.location_on_car,
                  size_estimate: d.size_estimate,
                  severity: d.severity,
                  confidence_score: d.confidence_score,
                  repair_cost_estimate_aed: d.repair_cost_estimate_aed ? Number(d.repair_cost_estimate_aed) : undefined,
                  description: d.description,
                  status: d.status,
                  detected_by_model: d.detected_by_model,
                  photo_position: d.photo_position,
                })),
              });
            } else {
              toast({ title: "Analysis Complete", description: "No damage detected." });
            }
          }
          fetchData();
          setAnalysing(null);
          return;
        }
        toast({ title: "Analysis Timeout", description: "Analysis is taking longer than expected. Check back later.", variant: "destructive" });
        setAnalysing(null);
      };
      poll();
    } catch (err: any) {
      toast({ title: "Analysis Failed", description: err.message || "Could not start the analysis.", variant: "destructive" });
      setAnalysing(null);
    }
  };

  const startInspection = () => {
    setTypeDialogOpen(false);
    setShowCaptureFlow(true);
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Vehicle not found</div>
      </div>
    );
  }

  if (showCaptureFlow) {
    return (
      <InspectionCaptureFlow
        vehicleId={vehicle.id}
        inspectionType={inspectionType}
        onComplete={() => {
          setShowCaptureFlow(false);
          fetchData();
        }}
        onCancel={() => setShowCaptureFlow(false)}
      />
    );
  }

  if (damageResults) {
    return (
      <div className="min-h-screen">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-4">
            <Button variant="ghost" size="icon" onClick={() => setDamageResults(null)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-primary">Damage</span> Report
            </h1>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-8">
          <DamageResults
            damageItems={damageResults.items}
            onClose={() => setDamageResults(null)}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-bold tracking-tight">
            <span className="text-primary">Fleet</span>Scan
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-8">
        {/* Vehicle Info */}
        <div className="flex flex-col md:flex-row gap-6">
          <div className="w-full md:w-80 aspect-video rounded-lg overflow-hidden bg-secondary flex-shrink-0">
            {vehicle.photo_url ? (
              <img src={vehicle.photo_url} alt={`${vehicle.make} ${vehicle.model}`} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Car className="h-12 w-12 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">{vehicle.make} {vehicle.model}</h2>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p><span className="text-foreground font-medium">Plate:</span> {vehicle.plate_number}</p>
              <p><span className="text-foreground font-medium">Colour:</span> {vehicle.colour}</p>
              <p><span className="text-foreground font-medium">Added:</span> {new Date(vehicle.created_at).toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        {/* Inspections */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Inspections</h3>
            <Dialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Camera className="h-4 w-4" />
                  New Inspection
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Start New Inspection</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Inspection Type</label>
                    <Select value={inspectionType} onValueChange={(v) => setInspectionType(v as "check-in" | "check-out")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="check-out">Check-Out</SelectItem>
                        <SelectItem value="check-in">Check-In</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    You'll be guided through 8 positions around the vehicle to capture photos.
                  </p>
                  <Button className="w-full gap-2" onClick={startInspection}>
                    <Camera className="h-4 w-4" />
                    Start Capture
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {inspections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No inspections recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {inspections.map((insp) => (
                <Card key={insp.id}>
                  <CardContent className="flex items-start justify-between p-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{new Date(insp.inspection_date).toLocaleDateString()}</p>
                        <Badge variant="secondary" className="text-xs capitalize">
                          {insp.inspection_type.replace("-", " ")}
                        </Badge>
                      </div>
                      {insp.notes && <p className="text-sm text-muted-foreground">{insp.notes}</p>}
                      <div className="flex items-center gap-3 mt-1">
                        <button
                          onClick={() => viewPhotos(insp.id)}
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Image className="h-3 w-3" />
                          View Photos
                        </button>
                        <button
                          onClick={() => viewDamageReport(insp.id)}
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Scan className="h-3 w-3" />
                          Damage Report
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-xs"
                        onClick={() => analyseInspection(insp.id)}
                        disabled={analysing === insp.id}
                      >
                        {analysing === insp.id ? (
                          <><Loader2 className="h-3 w-3 animate-spin" /> Analysing...</>
                        ) : (
                          <><Scan className="h-3 w-3" /> Analyse</>
                        )}
                      </Button>
                      <Badge variant="outline" className={statusColor(insp.status)}>
                        {insp.status.replace("_", " ")}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Photo viewer dialog */}
        <Dialog open={!!viewingPhotos} onOpenChange={() => setViewingPhotos(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Inspection Photos</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {viewingPhotos?.map((photo) => (
                <div key={photo.id} className="space-y-1">
                  <div className="aspect-video rounded-lg overflow-hidden bg-secondary">
                    <img src={photo.photo_url} alt={photo.position_name} className="h-full w-full object-cover" />
                  </div>
                  <p className="text-xs text-muted-foreground text-center">{photo.position_number}. {photo.position_name}</p>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default VehicleDetail;
