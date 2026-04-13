import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import AddVehicleDialog from "@/components/AddVehicleDialog";
import { LogOut, Car, Calendar } from "lucide-react";

interface VehicleWithInspection {
  id: string;
  make: string;
  model: string;
  plate_number: string;
  colour: string;
  photo_url: string | null;
  last_inspection_date: string | null;
}

const Index = () => {
  const { user, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState<VehicleWithInspection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/login");
    }
  }, [user, authLoading, navigate]);

  const fetchVehicles = async () => {
    if (!user) return;
    const { data: vehiclesData } = await supabase
      .from("vehicles")
      .select("*")
      .order("created_at", { ascending: false });

    if (!vehiclesData) { setLoading(false); return; }

    const vehiclesWithInspections = await Promise.all(
      vehiclesData.map(async (v) => {
        const { data: inspections } = await supabase
          .from("inspections")
          .select("inspection_date")
          .eq("vehicle_id", v.id)
          .order("inspection_date", { ascending: false })
          .limit(1);
        return {
          ...v,
          last_inspection_date: inspections?.[0]?.inspection_date || null,
        };
      })
    );

    setVehicles(vehiclesWithInspections);
    setLoading(false);
  };

  useEffect(() => {
    if (user) fetchVehicles();
  }, [user]);

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <h1 className="text-xl font-bold tracking-tight">
            <span className="text-primary">Fleet</span>Scan
          </h1>
          <div className="flex items-center gap-3">
            <AddVehicleDialog onVehicleAdded={fetchVehicles} />
            <Button variant="ghost" size="icon" onClick={signOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {vehicles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Car className="mb-4 h-12 w-12 text-muted-foreground" />
            <h2 className="text-lg font-medium">No vehicles yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">Add your first vehicle to get started.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {vehicles.map((v) => (
              <Card
                key={v.id}
                className="cursor-pointer transition-colors hover:border-primary/50"
                onClick={() => navigate(`/vehicle/${v.id}`)}
              >
                <div className="aspect-video overflow-hidden rounded-t-lg bg-secondary">
                  {v.photo_url ? (
                    <img src={v.photo_url} alt={`${v.make} ${v.model}`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Car className="h-10 w-10 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <CardContent className="p-4">
                  <h3 className="font-semibold">{v.make} {v.model}</h3>
                  <p className="text-sm text-muted-foreground">{v.plate_number}</p>
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {v.last_inspection_date
                      ? `Last inspected: ${new Date(v.last_inspection_date).toLocaleDateString()}`
                      : "No inspections"}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
