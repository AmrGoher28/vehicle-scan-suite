import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import CarDiagram, { POSITIONS } from "@/components/CarDiagram";
import { Camera, RotateCcw, ArrowRight, X, Check } from "lucide-react";

interface InspectionCaptureFlowProps {
  vehicleId: string;
  inspectionType: "check-in" | "check-out";
  onComplete: () => void;
  onCancel: () => void;
}

const InspectionCaptureFlow = ({
  vehicleId,
  inspectionType,
  onComplete,
  onCancel,
}: InspectionCaptureFlowProps) => {
  const [currentPosition, setCurrentPosition] = useState(1);
  const [capturedPhotos, setCapturedPhotos] = useState<Record<number, string>>({});
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();

  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setCameraReady(true);
      }
    } catch {
      toast({ title: "Camera Error", description: "Could not access the camera. Please allow camera permissions.", variant: "destructive" });
    }
  }, [toast]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  useEffect(() => {
    if (!previewPhoto) {
      startCamera();
    }
    return () => stopCamera();
  }, [previewPhoto, startCamera, stopCamera]);

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setPreviewPhoto(dataUrl);
    stopCamera();
  };

  const retake = () => {
    setPreviewPhoto(null);
  };

  const acceptPhoto = () => {
    if (!previewPhoto) return;
    setCapturedPhotos((prev) => ({ ...prev, [currentPosition]: previewPhoto }));
    setPreviewPhoto(null);

    if (currentPosition < 8) {
      setCurrentPosition((p) => p + 1);
    }
  };

  const dataUrlToBlob = (dataUrl: string): Blob => {
    const [header, base64] = dataUrl.split(",");
    const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
    const binary = atob(base64);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };

  const saveInspection = async () => {
    if (!user || Object.keys(capturedPhotos).length < 8) return;
    setSaving(true);

    try {
      // Create inspection record
      const { data: inspection, error: inspError } = await supabase
        .from("inspections")
        .insert({
          vehicle_id: vehicleId,
          inspection_type: inspectionType,
          status: "pending",
          notes: `${inspectionType === "check-out" ? "Check-out" : "Check-in"} inspection with 8 photos`,
        })
        .select()
        .single();

      if (inspError || !inspection) throw inspError;

      // Upload all photos and create photo records
      for (const [posNum, dataUrl] of Object.entries(capturedPhotos)) {
        const pos = POSITIONS.find((p) => p.id === Number(posNum))!;
        const blob = dataUrlToBlob(dataUrl);
        const filePath = `${user.id}/${inspection.id}/position-${posNum}.jpg`;

        const { error: uploadErr } = await supabase.storage
          .from("inspection-photos")
          .upload(filePath, blob, { contentType: "image/jpeg" });
        if (uploadErr) throw uploadErr;

        const { data: urlData } = supabase.storage
          .from("inspection-photos")
          .getPublicUrl(filePath);

        const { error: photoErr } = await supabase.from("inspection_photos").insert({
          inspection_id: inspection.id,
          position_number: Number(posNum),
          position_name: pos.label,
          photo_url: urlData.publicUrl,
        });
        if (photoErr) throw photoErr;
      }

      toast({ title: "Inspection saved", description: "All 8 photos have been uploaded successfully." });
      onComplete();
    } catch (error: any) {
      toast({ title: "Error saving inspection", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const allCaptured = Object.keys(capturedPhotos).length === 8;
  const currentPosData = POSITIONS.find((p) => p.id === currentPosition)!;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Hidden canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => { stopCamera(); onCancel(); }}>
          <X className="h-5 w-5" />
        </Button>
        <div className="text-center">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
            {inspectionType === "check-out" ? "Check-Out" : "Check-In"}
          </p>
          <p className="text-sm font-semibold">
            Position {currentPosition} of 8: {currentPosData.label}
          </p>
        </div>
        <div className="w-10" />
      </div>

      {/* Main area */}
      <div className="flex-1 relative overflow-hidden">
        {previewPhoto ? (
          <img src={previewPhoto} alt="Captured" className="h-full w-full object-cover" />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />
        )}

        {/* Diagram overlay */}
        {!previewPhoto && (
          <div className="absolute top-4 right-4 w-28 h-28 bg-background/70 backdrop-blur-sm rounded-xl p-2 border border-border">
            <CarDiagram activePosition={currentPosition} />
          </div>
        )}
      </div>

      {/* Progress dots */}
      <div className="flex justify-center gap-2 py-3 bg-card border-t border-border">
        {POSITIONS.map((pos) => (
          <button
            key={pos.id}
            onClick={() => {
              if (capturedPhotos[pos.id] || pos.id === currentPosition) {
                setCurrentPosition(pos.id);
                setPreviewPhoto(capturedPhotos[pos.id] || null);
              }
            }}
            className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center transition-colors ${
              capturedPhotos[pos.id]
                ? "bg-primary text-primary-foreground"
                : pos.id === currentPosition
                ? "border-2 border-primary text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {capturedPhotos[pos.id] ? <Check className="h-3.5 w-3.5" /> : pos.id}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-4 px-6 py-4 bg-card">
        {previewPhoto ? (
          <>
            <Button variant="outline" size="lg" onClick={retake} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Retake
            </Button>
            {allCaptured && currentPosition === 8 ? (
              <Button size="lg" onClick={saveInspection} disabled={saving} className="gap-2">
                {saving ? "Saving..." : <>
                  <Check className="h-4 w-4" />
                  Save Inspection
                </>}
              </Button>
            ) : (
              <Button size="lg" onClick={acceptPhoto} className="gap-2">
                <ArrowRight className="h-4 w-4" />
                Next
              </Button>
            )}
          </>
        ) : (
          <button
            onClick={capturePhoto}
            disabled={!cameraReady}
            className="w-18 h-18 rounded-full border-4 border-primary bg-primary/20 flex items-center justify-center transition-transform active:scale-95 disabled:opacity-50"
          >
            <Camera className="h-7 w-7 text-primary" />
          </button>
        )}
      </div>
    </div>
  );
};

export default InspectionCaptureFlow;
