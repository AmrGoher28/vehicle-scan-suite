import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";

interface AddVehicleDialogProps {
  onVehicleAdded: () => void;
}

const AddVehicleDialog = ({ onVehicleAdded }: AddVehicleDialogProps) => {
  const [open, setOpen] = useState(false);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [colour, setColour] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);

    try {
      let photo_url: string | null = null;

      if (photo) {
        const fileExt = photo.name.split(".").pop();
        const filePath = `${user.id}/${crypto.randomUUID()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from("vehicle-photos")
          .upload(filePath, photo);
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from("vehicle-photos")
          .getPublicUrl(filePath);
        photo_url = urlData.publicUrl;
      }

      const { error } = await supabase.from("vehicles").insert({
        user_id: user.id,
        make,
        model,
        colour,
        plate_number: plateNumber,
        photo_url,
      });

      if (error) throw error;

      toast({ title: "Vehicle added successfully" });
      setOpen(false);
      setMake("");
      setModel("");
      setColour("");
      setPlateNumber("");
      setPhoto(null);
      onVehicleAdded();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Vehicle
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Vehicle</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="make">Make</Label>
              <Input id="make" value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Corolla" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="colour">Colour</Label>
              <Input id="colour" value={colour} onChange={(e) => setColour(e.target.value)} placeholder="Silver" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plate">Plate Number</Label>
              <Input id="plate" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} placeholder="ABC-1234" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="photo">Vehicle Photo</Label>
            <Input id="photo" type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Adding..." : "Add Vehicle"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddVehicleDialog;
