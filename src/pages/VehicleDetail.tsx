import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AddInspectionDialog from "@/components/AddInspectionDialog";
import { ArrowLeft, Car } from "lucide-react";

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
  notes: string | null;
  status: string;
  created_at: string;
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
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);

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
            <AddInspectionDialog vehicleId={vehicle.id} onInspectionAdded={fetchData} />
          </div>

          {inspections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No inspections recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {inspections.map((insp) => (
                <Card key={insp.id}>
                  <CardContent className="flex items-start justify-between p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{new Date(insp.inspection_date).toLocaleDateString()}</p>
                      {insp.notes && <p className="text-sm text-muted-foreground">{insp.notes}</p>}
                    </div>
                    <Badge variant="outline" className={statusColor(insp.status)}>
                      {insp.status.replace("_", " ")}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default VehicleDetail;
