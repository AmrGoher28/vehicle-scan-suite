import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import CarDiagram, { POSITIONS } from "@/components/CarDiagram";
import { Camera, Video, X, CheckCircle, RotateCcw, ArrowRight, Check, MoveRight, MoveLeft } from "lucide-react";

// ─── AR Overlay Components ───────────────────────────────────────────────────

/** Corner framing brackets that pulse to guide positioning */
const FramingBrackets = () => (
  <div className="absolute inset-0 pointer-events-none ar-bracket-pulse">
    {/* Top-left */}
    <div className="absolute top-[15%] left-[10%] w-12 h-12 border-t-2 border-l-2 border-primary rounded-tl-md" />
    {/* Top-right */}
    <div className="absolute top-[15%] right-[10%] w-12 h-12 border-t-2 border-r-2 border-primary rounded-tr-md" />
    {/* Bottom-left */}
    <div className="absolute bottom-[15%] left-[10%] w-12 h-12 border-b-2 border-l-2 border-primary rounded-bl-md" />
    {/* Bottom-right */}
    <div className="absolute bottom-[15%] right-[10%] w-12 h-12 border-b-2 border-r-2 border-primary rounded-br-md" />
  </div>
);

/** Scanning line that sweeps vertically over the camera feed */
const ScanLine = () => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden">
    <div className="ar-scan-line absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent opacity-60" />
  </div>
);

/** Distance indicator hint */
const DistanceIndicator = ({ elapsed, zoneDuration }: { elapsed: number; zoneDuration: number }) => {
  const ratio = (elapsed % zoneDuration) / zoneDuration;
  const label = ratio < 0.25 ? "Get closer" : ratio < 0.75 ? "Perfect distance" : "Step back slowly";
  const color = ratio < 0.25 ? "text-yellow-400" : ratio < 0.75 ? "text-green-400" : "text-orange-400";
  return (
    <div className={`absolute top-14 left-1/2 -translate-x-1/2 ${color} text-xs font-semibold bg-black/50 px-3 py-1 rounded-full backdrop-blur-sm`}>
      {label}
    </div>
  );
};

/** Large zone label overlay with walk direction arrow */
const ZoneOverlay = ({ zone, nextDirection }: { zone: typeof ZONES[number]; nextDirection: "right" | "left" }) => (
  <div className="absolute top-4 left-4 pointer-events-none">
    <div className="bg-black/50 backdrop-blur-sm rounded-lg px-4 py-2 border border-primary/30">
      <p className="text-primary text-lg font-bold tracking-wider">{zone.label.toUpperCase()}</p>
      <div className="flex items-center gap-1.5 mt-1 ar-arrow-bounce">
        {nextDirection === "right" ? <MoveRight className="h-3.5 w-3.5 text-primary/70" /> : <MoveLeft className="h-3.5 w-3.5 text-primary/70" />}
        <span className="text-[10px] text-primary/70 font-medium">Walk {nextDirection}</span>
      </div>
    </div>
  </div>
);

/** Vehicle silhouette guide for manual mode — shows outline matching the current position */
const ManualFramingGuide = ({ position }: { position: number }) => {
  // SVG outlines: front(1), rear(5) = face-on, sides(3,7) = profile, corners = angled
  const isFront = position === 1;
  const isRear = position === 5;
  const isSide = position === 3 || position === 7;
  const flip = position === 7 || position === 6 || position === 8;

  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      <svg
        viewBox="0 0 200 140"
        className="w-[60%] max-w-[300px] opacity-20"
        style={{ transform: flip ? "scaleX(-1)" : undefined }}
      >
        {(isFront || isRear) ? (
          /* Face-on view */
          <g stroke="hsl(var(--primary))" strokeWidth="1.5" fill="none">
            <rect x="40" y="30" width="120" height="80" rx="12" />
            <rect x="50" y="40" width="100" height="30" rx="6" />
            <circle cx="60" cy="100" r="12" />
            <circle cx="140" cy="100" r="12" />
            {isFront && <line x1="60" y1="38" x2="140" y2="38" strokeWidth="1" opacity="0.5" />}
          </g>
        ) : isSide ? (
          /* Side profile */
          <g stroke="hsl(var(--primary))" strokeWidth="1.5" fill="none">
            <path d="M20,90 L20,60 Q20,40 40,35 L80,28 Q100,25 120,28 L160,35 Q180,40 180,60 L180,90" />
            <line x1="20" y1="90" x2="180" y2="90" />
            <circle cx="50" cy="95" r="14" />
            <circle cx="150" cy="95" r="14" />
            <path d="M70,35 L70,60 L130,60 L130,35" opacity="0.5" />
          </g>
        ) : (
          /* Corner / 3/4 view */
          <g stroke="hsl(var(--primary))" strokeWidth="1.5" fill="none">
            <path d="M30,85 L30,55 Q35,38 55,32 L100,25 Q130,22 155,30 L170,40 Q178,50 178,65 L178,85" />
            <line x1="30" y1="85" x2="178" y2="85" />
            <circle cx="55" cy="90" r="13" />
            <circle cx="155" cy="90" r="13" />
            <path d="M65,33 Q80,45 80,55 L140,55 Q140,38 130,30" opacity="0.5" />
          </g>
        )}
      </svg>
    </div>
  );
};

// ─── Zone definitions ────────────────────────────────────────────────────────
const ZONES = [
  { id: 1, label: "Front",           short: "FRONT",  duration: 5 },
  { id: 2, label: "Front-Left",      short: "FL",     duration: 4 },
  { id: 3, label: "Left Side",       short: "LEFT",   duration: 5 },
  { id: 4, label: "Rear-Left",       short: "RL",     duration: 4 },
  { id: 5, label: "Rear",            short: "REAR",   duration: 5 },
  { id: 6, label: "Rear-Right",      short: "RR",     duration: 4 },
  { id: 7, label: "Right Side",      short: "RIGHT",  duration: 5 },
  { id: 8, label: "Front-Right",     short: "FR",     duration: 4 },
] as const;

const TOTAL_DURATION = ZONES.reduce((s, z) => s + z.duration, 0);

interface InspectionCaptureFlowProps {
  vehicleId: string;
  inspectionType: "check-in" | "check-out";
  onComplete: () => void;
  onCancel: () => void;
}

type CaptureMode = "select" | "video" | "manual";

const InspectionCaptureFlow = ({
  vehicleId,
  inspectionType,
  onComplete,
  onCancel,
}: InspectionCaptureFlowProps) => {
  const [mode, setMode] = useState<CaptureMode>("select");

  // Manual mode state
  const [currentPosition, setCurrentPosition] = useState(1);
  const [capturedPhotos, setCapturedPhotos] = useState<Record<number, string>>({});
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  // Video mode state
  const [recording, setRecording] = useState(false);
  const [videoElapsed, setVideoElapsed] = useState(0);
  const [currentZone, setCurrentZone] = useState(0);
  const [extractedFrames, setExtractedFrames] = useState<Record<number, string>>({});
  const [videoFinished, setVideoFinished] = useState(false);

  // Shared state
  const [saving, setSaving] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { user } = useAuth();
  const { toast } = useToast();

  // ─── Camera helpers ──────────────────────────────────────────────────────
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
      toast({
        title: "Camera Error",
        description: "Could not access the camera. Please allow camera permissions.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  // Start camera when entering manual or video mode (not in preview)
  useEffect(() => {
    if (mode === "manual" && !previewPhoto) {
      startCamera();
    } else if (mode === "video" && !videoFinished) {
      startCamera();
    }
    return () => stopCamera();
  }, [mode, previewPhoto, videoFinished, startCamera, stopCamera]);

  // ─── Video recording helpers ─────────────────────────────────────────────
  const getCurrentZoneIndex = (elapsed: number): number => {
    let acc = 0;
    for (let i = 0; i < ZONES.length; i++) {
      acc += ZONES[i].duration;
      if (elapsed < acc) return i;
    }
    return ZONES.length - 1;
  };

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  }, []);

  const startRecording = useCallback(() => {
    setRecording(true);
    setVideoElapsed(0);
    setCurrentZone(0);
    setExtractedFrames({});

    // Capture frames at zone midpoints
    const capturedZones = new Set<number>();
    let elapsed = 0;

    timerRef.current = setInterval(() => {
      elapsed += 0.5;
      setVideoElapsed(elapsed);

      const zoneIdx = getCurrentZoneIndex(elapsed);
      setCurrentZone(zoneIdx);

      // Capture a frame at the midpoint of each zone
      if (!capturedZones.has(zoneIdx)) {
        let zoneStart = 0;
        for (let i = 0; i < zoneIdx; i++) zoneStart += ZONES[i].duration;
        const midpoint = zoneStart + ZONES[zoneIdx].duration / 2;

        if (elapsed >= midpoint) {
          const frame = captureFrame();
          if (frame) {
            capturedZones.add(zoneIdx);
            setExtractedFrames((prev) => ({ ...prev, [ZONES[zoneIdx].id]: frame }));
          }
        }
      }

      if (elapsed >= TOTAL_DURATION) {
        stopRecording();
      }
    }, 500);
  }, [captureFrame]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    setVideoFinished(true);
    stopCamera();
  }, [stopCamera]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ─── Manual mode capture ────────────────────────────────────────────────
  const capturePhoto = () => {
    const frame = captureFrame();
    if (frame) {
      setPreviewPhoto(frame);
      stopCamera();
    }
  };

  const retake = () => setPreviewPhoto(null);

  const acceptPhoto = () => {
    if (!previewPhoto) return;
    setCapturedPhotos((prev) => ({ ...prev, [currentPosition]: previewPhoto }));
    setPreviewPhoto(null);
    if (currentPosition < 8) setCurrentPosition((p) => p + 1);
  };

  // ─── Save inspection ───────────────────────────────────────────────────
  const dataUrlToBlob = (dataUrl: string): Blob => {
    const [header, base64] = dataUrl.split(",");
    const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
    const binary = atob(base64);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };

  const saveInspection = async (photos: Record<number, string>) => {
    if (!user) return;
    setSaving(true);

    try {
      const { data: inspection, error: inspError } = await supabase
        .from("inspections")
        .insert({
          vehicle_id: vehicleId,
          inspection_type: inspectionType,
          status: "pending",
          notes: `${inspectionType === "check-out" ? "Check-out" : "Check-in"} inspection with ${Object.keys(photos).length} photos`,
        })
        .select()
        .single();

      if (inspError || !inspection) throw inspError;

      for (const [posNum, dataUrl] of Object.entries(photos)) {
        const pos = POSITIONS.find((p) => p.id === Number(posNum));
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
          position_name: pos?.label || `Position ${posNum}`,
          photo_url: urlData.publicUrl,
        });
        if (photoErr) throw photoErr;
      }

      toast({ title: "Inspection saved", description: "All photos have been uploaded successfully." });
      onComplete();
    } catch (error: any) {
      toast({ title: "Error saving inspection", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const allManualCaptured = Object.keys(capturedPhotos).length === 8;
  const allVideoFrames = Object.keys(extractedFrames).length === 8;
  const currentPosData = POSITIONS.find((p) => p.id === currentPosition)!;

  // ─── Mode selection screen ──────────────────────────────────────────────
  if (mode === "select") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-border">
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="h-5 w-5" />
          </Button>
          <p className="text-sm font-semibold">
            {inspectionType === "check-out" ? "Check-Out" : "Check-In"} Inspection
          </p>
          <div className="w-10" />
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
          <h2 className="text-xl font-bold text-center">Choose Capture Method</h2>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            Walk around the vehicle to capture all 8 positions. You can record a continuous video or take individual photos.
          </p>

          <div className="grid gap-4 w-full max-w-sm">
            <Button
              variant="outline"
              size="lg"
              className="h-24 flex flex-col gap-2"
              onClick={() => setMode("video")}
            >
              <Video className="h-8 w-8 text-primary" />
              <div className="text-center">
                <p className="font-semibold">Video Walkaround</p>
                <p className="text-xs text-muted-foreground">~{TOTAL_DURATION}s guided recording</p>
              </div>
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="h-24 flex flex-col gap-2"
              onClick={() => setMode("manual")}
            >
              <Camera className="h-8 w-8 text-primary" />
              <div className="text-center">
                <p className="font-semibold">Manual Photos</p>
                <p className="text-xs text-muted-foreground">8 individual photos</p>
              </div>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Video walkaround mode ──────────────────────────────────────────────
  if (mode === "video") {
    const zone = ZONES[currentZone];
    const progress = (videoElapsed / TOTAL_DURATION) * 100;

    // Video finished — show extracted frames review
    if (videoFinished) {
      const frameCount = Object.keys(extractedFrames).length;
      return (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-border">
            <Button variant="ghost" size="icon" onClick={() => { setVideoFinished(false); setMode("select"); }}>
              <X className="h-5 w-5" />
            </Button>
            <p className="text-sm font-semibold">Review Captured Frames</p>
            <div className="w-10" />
          </div>

          <div className="flex-1 overflow-auto p-4">
            <p className="text-sm text-muted-foreground text-center mb-4">
              {frameCount} of 8 frames captured automatically
            </p>
            <div className="grid grid-cols-2 gap-3">
              {ZONES.map((z) => (
                <div key={z.id} className="relative rounded-lg overflow-hidden border border-border aspect-video bg-muted">
                  {extractedFrames[z.id] ? (
                    <>
                      <img src={extractedFrames[z.id]} alt={z.label} className="w-full h-full object-cover" />
                      <div className="absolute top-1 right-1">
                        <CheckCircle className="h-5 w-5 text-primary" />
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-xs text-muted-foreground">Missing</p>
                    </div>
                  )}
                  <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-xs text-center py-1">
                    {z.short} — {z.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center gap-4 px-6 py-4 bg-card border-t border-border">
            <Button variant="outline" size="lg" onClick={() => { setVideoFinished(false); setExtractedFrames({}); setMode("select"); }} className="gap-2">
              <RotateCcw className="h-4 w-4" /> Redo
            </Button>
            {frameCount >= 6 && (
              <Button size="lg" onClick={() => saveInspection(extractedFrames)} disabled={saving} className="gap-2">
                {saving ? "Saving..." : <><Check className="h-4 w-4" /> Save Inspection</>}
              </Button>
            )}
          </div>
        </div>
      );
    }

    // Active recording / pre-recording view
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <canvas ref={canvasRef} className="hidden" />

        {/* Top bar with zone info */}
        <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-border">
          <Button variant="ghost" size="icon" onClick={() => { stopRecording(); stopCamera(); setMode("select"); }}>
            <X className="h-5 w-5" />
          </Button>
          <div className="text-center">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              {recording ? `Zone ${currentZone + 1}/8` : "Video Walkaround"}
            </p>
            <p className="text-sm font-semibold">
              {recording ? zone.label : "Position yourself at the front of the vehicle"}
            </p>
          </div>
          <div className="w-10" />
        </div>

        {/* Progress bar */}
        {recording && (
          <div className="h-1.5 bg-muted">
            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        )}

        {/* Camera preview */}
        <div className="flex-1 relative overflow-hidden">
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />

          {/* AR Overlays — visible during recording */}
          {recording && (
            <>
              <FramingBrackets />
              <ScanLine />
              <DistanceIndicator elapsed={videoElapsed} zoneDuration={zone.duration} />
              <ZoneOverlay zone={zone} nextDirection={currentZone < 4 ? "right" : "left"} />
            </>
          )}

          {/* Framing brackets before recording starts */}
          {!recording && cameraReady && <FramingBrackets />}

          {/* Zone coverage map overlay */}
          {recording && (
            <div className="absolute top-4 right-4 w-28 bg-background/70 backdrop-blur-sm rounded-xl p-2 border border-border">
              <div className="grid grid-cols-4 gap-1">
                {ZONES.map((z, i) => (
                  <div
                    key={z.id}
                    className={`text-[8px] text-center py-1 rounded font-bold ${
                      extractedFrames[z.id]
                        ? "bg-primary text-primary-foreground"
                        : i === currentZone
                        ? "bg-primary/30 text-primary border border-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {z.short}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Countdown / zone timer */}
          {recording && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 text-white rounded-full px-6 py-2 text-sm font-mono">
              {Math.ceil(TOTAL_DURATION - videoElapsed)}s remaining — Move to {zone.label}
            </div>
          )}
        </div>

        {/* Action bar */}
        <div className="flex items-center justify-center gap-4 px-6 py-4 bg-card border-t border-border">
          {!recording ? (
            <Button size="lg" onClick={startRecording} disabled={!cameraReady} className="gap-2">
              <Video className="h-5 w-5" />
              Start Recording
            </Button>
          ) : (
            <Button variant="destructive" size="lg" onClick={stopRecording} className="gap-2">
              <X className="h-5 w-5" />
              Stop Early
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ─── Manual photo capture mode ──────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <canvas ref={canvasRef} className="hidden" />

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => { stopCamera(); setMode("select"); }}>
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
          <>
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
            {/* AR overlays for manual mode */}
            {cameraReady && (
              <>
                <FramingBrackets />
                <ManualFramingGuide position={currentPosition} />
              </>
            )}
          </>
        )}

        {/* Diagram overlay */}
        {!previewPhoto && (
          <div className="absolute top-4 right-4 w-28 h-28 bg-background/70 backdrop-blur-sm rounded-xl p-2 border border-border">
            <CarDiagram activePosition={currentPosition} />
          </div>
        )}

        {/* Position label overlay */}
        {!previewPhoto && cameraReady && (
          <div className="absolute top-4 left-4 pointer-events-none">
            <div className="bg-black/50 backdrop-blur-sm rounded-lg px-4 py-2 border border-primary/30">
              <p className="text-primary text-sm font-bold tracking-wider">{currentPosData.label.toUpperCase()}</p>
              <p className="text-[10px] text-primary/70 mt-0.5">Align vehicle with the guide</p>
            </div>
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
              <RotateCcw className="h-4 w-4" /> Retake
            </Button>
            {allManualCaptured && currentPosition === 8 ? (
              <Button size="lg" onClick={() => saveInspection(capturedPhotos)} disabled={saving} className="gap-2">
                {saving ? "Saving..." : <><Check className="h-4 w-4" /> Save Inspection</>}
              </Button>
            ) : (
              <Button size="lg" onClick={acceptPhoto} className="gap-2">
                <ArrowRight className="h-4 w-4" /> Next
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
