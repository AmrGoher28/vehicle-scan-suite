import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Camera, X, Check, RotateCcw, ChevronRight, AlertCircle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = "overview" | "detail" | "wheels";
type TargetDistance = "far" | "close";
type ProximityStatus = "too_far" | "good" | "too_close" | "too_dark" | "unknown";
type AppState = "intro" | "capturing" | "preview" | "stage_complete" | "review" | "saving";
type ViewAngle = "front" | "rear" | "side" | "corner" | "low" | "wheel";

interface ShotDef {
  id: number;
  stage: Stage;
  label: string;
  instruction: string;
  hint: string;
  target: TargetDistance;
  viewAngle: ViewAngle;
  flip?: boolean;
}

interface StageMeta {
  num: number;
  label: string;
  emoji: string;
  color: string;
  ring: string;
  count: number;
}

// ─── Shot Definitions (18 shots, ~2 min) ─────────────────────────────────────

const SHOTS: ShotDef[] = [
  { id: 1,  stage: "overview", label: "Front",             instruction: "Stand in front of the car",         hint: "Show the full front bumper and headlights",    target: "far",   viewAngle: "front"  },
  { id: 2,  stage: "overview", label: "Front-Left Corner", instruction: "Move to the front-left corner",     hint: "Both the front and left side should be visible", target: "far", viewAngle: "corner" },
  { id: 3,  stage: "overview", label: "Left Side",         instruction: "Stand along the left side",         hint: "Step back until the whole side fits in frame", target: "far",   viewAngle: "side"   },
  { id: 4,  stage: "overview", label: "Rear-Left Corner",  instruction: "Move to the rear-left corner",      hint: "Both the rear and left side should be visible", target: "far",  viewAngle: "corner", flip: true },
  { id: 5,  stage: "overview", label: "Rear",              instruction: "Stand behind the car",              hint: "Show the full rear bumper and tail lights",    target: "far",   viewAngle: "rear"   },
  { id: 6,  stage: "overview", label: "Rear-Right Corner", instruction: "Move to the rear-right corner",     hint: "Both the rear and right side should be visible", target: "far", viewAngle: "corner" },
  { id: 7,  stage: "overview", label: "Right Side",        instruction: "Stand along the right side",        hint: "Step back until the whole side fits in frame", target: "far",   viewAngle: "side",   flip: true },
  { id: 8,  stage: "overview", label: "Front-Right Corner",instruction: "Move to the front-right corner",    hint: "Both the front and right side should be visible", target: "far", viewAngle: "corner", flip: true },
  { id: 9,  stage: "detail",   label: "Front Bumper",      instruction: "Crouch at the front of the car",    hint: "Phone at bumper height, 40–60 cm away",        target: "close", viewAngle: "low"    },
  { id: 10, stage: "detail",   label: "Left Door Panels",  instruction: "Stand close to the left doors",     hint: "Fill the frame with the door surface, ~50 cm", target: "close", viewAngle: "side"   },
  { id: 11, stage: "detail",   label: "Left Sill",         instruction: "Crouch along the left side",        hint: "Shoot along the bottom edge of the car",       target: "close", viewAngle: "low"    },
  { id: 12, stage: "detail",   label: "Right Door Panels", instruction: "Stand close to the right doors",    hint: "Fill the frame with the door surface, ~50 cm", target: "close", viewAngle: "side",   flip: true },
  { id: 13, stage: "detail",   label: "Right Sill",        instruction: "Crouch along the right side",       hint: "Shoot along the bottom edge of the car",       target: "close", viewAngle: "low",    flip: true },
  { id: 14, stage: "detail",   label: "Rear Bumper",       instruction: "Crouch at the rear of the car",     hint: "Phone at bumper height, 40–60 cm away",        target: "close", viewAngle: "low",    flip: true },
  { id: 15, stage: "wheels",   label: "Front-Left Wheel",  instruction: "Crouch at the front-left wheel",   hint: "Centre the rim in frame, 30–50 cm away",       target: "close", viewAngle: "wheel"  },
  { id: 16, stage: "wheels",   label: "Rear-Left Wheel",   instruction: "Crouch at the rear-left wheel",    hint: "Centre the rim in frame, 30–50 cm away",       target: "close", viewAngle: "wheel"  },
  { id: 17, stage: "wheels",   label: "Rear-Right Wheel",  instruction: "Crouch at the rear-right wheel",   hint: "Centre the rim in frame, 30–50 cm away",       target: "close", viewAngle: "wheel"  },
  { id: 18, stage: "wheels",   label: "Front-Right Wheel", instruction: "Crouch at the front-right wheel",  hint: "Centre the rim in frame, 30–50 cm away",       target: "close", viewAngle: "wheel"  },
];

const STAGE_META: Record<Stage, StageMeta> = {
  overview: { num: 1, label: "Overview",    emoji: "🚗", color: "text-blue-400",    ring: "#60a5fa", count: 8 },
  detail:   { num: 2, label: "Detail Scan", emoji: "🔍", color: "text-amber-400",   ring: "#fbbf24", count: 6 },
  wheels:   { num: 3, label: "Wheel Check", emoji: "⚙️",  color: "text-emerald-400", ring: "#34d399", count: 4 },
};

const STAGES: Stage[] = ["overview", "detail", "wheels"];

// ─── Frame Analysis (proximity detection) ────────────────────────────────────

function analyzeFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, target: TargetDistance): ProximityStatus {
  if (!video.videoWidth) return "unknown";
  const W = 120, H = 90;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "unknown";
  ctx.drawImage(video, video.videoWidth * 0.25, video.videoHeight * 0.25, video.videoWidth * 0.5, video.videoHeight * 0.5, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  let sum = 0, sumSq = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += g; sumSq += g * g; n++;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  if (mean < 35) return "too_dark";
  if (target === "far") {
    if (variance < 350) return "too_far";
    if (variance > 3800) return "too_close";
    return "good";
  } else {
    if (variance < 650) return "too_far";
    if (variance > 6500) return "too_close";
    return "good";
  }
}

// ─── SVG Shot Guide ───────────────────────────────────────────────────────────

const ShotGuide = ({ angle, flip }: { angle: ViewAngle; flip?: boolean }) => {
  const content = () => {
    switch (angle) {
      case "front":
      case "rear":
        return (
          <g>
            <rect x="30" y="30" width="140" height="100" rx="12" fill="none" stroke="white" strokeWidth="2" opacity="0.6" />
            <line x1="100" y1="30" x2="100" y2="130" stroke="white" strokeWidth="1" opacity="0.3" />
            <line x1="30" y1="80" x2="170" y2="80" stroke="white" strokeWidth="1" opacity="0.3" />
            <circle cx="60" cy="55" r="12" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5" />
            {angle === "front" && <circle cx="140" cy="55" r="12" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5" />}
            <rect x="50" y="110" width="100" height="15" rx="4" fill="none" stroke="white" strokeWidth="1.5" opacity="0.4" />
            <line x1="100" y1="145" x2="100" y2="160" stroke="white" strokeWidth="1" opacity="0.3" strokeDasharray="4 2" />
          </g>
        );
      case "side":
        return (
          <g>
            <rect x="15" y="50" width="170" height="70" rx="8" fill="none" stroke="white" strokeWidth="2" opacity="0.6" />
            <circle cx="50" cy="120" r="18" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5" />
            <circle cx="150" cy="120" r="18" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5" />
            <line x1="15" y1="85" x2="185" y2="85" stroke="white" strokeWidth="1" opacity="0.3" />
            <rect x="40" y="55" width="50" height="25" rx="4" fill="none" stroke="white" strokeWidth="1" opacity="0.3" />
          </g>
        );
      case "corner":
        return (
          <g>
            <path d="M40,120 L40,50 Q40,40 50,40 L160,60 Q170,62 170,72 L170,120 Z" fill="none" stroke="white" strokeWidth="2" opacity="0.6" />
            <circle cx="55" cy="120" r="15" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5" />
            <circle cx="155" cy="120" r="15" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5" />
            <line x1="40" y1="85" x2="170" y2="90" stroke="white" strokeWidth="1" opacity="0.3" />
            <rect x="55" y="48" width="40" height="20" rx="4" fill="none" stroke="white" strokeWidth="1" opacity="0.3" />
          </g>
        );
      case "low":
        return (
          <g>
            <rect x="20" y="40" width="160" height="50" rx="6" fill="none" stroke="white" strokeWidth="2" opacity="0.6" />
            <rect x="20" y="90" width="160" height="30" rx="4" fill="none" stroke="white" strokeWidth="1.5" opacity="0.4" />
            <line x1="20" y1="90" x2="180" y2="90" stroke="white" strokeWidth="2" opacity="0.5" />
            <line x1="100" y1="130" x2="100" y2="150" stroke="white" strokeWidth="1" opacity="0.3" strokeDasharray="4 2" />
            <text x="100" y="148" textAnchor="middle" fill="white" fontSize="10" opacity="0.4">↑ camera low</text>
          </g>
        );
      case "wheel":
        return (
          <g>
            <circle cx="100" cy="72" r="50" fill="none" stroke="white" strokeWidth="2" opacity="0.6" />
            <circle cx="100" cy="72" r="20" fill="none" stroke="white" strokeWidth="1.5" opacity="0.4" />
            <circle cx="100" cy="72" r="8" fill="white" opacity="0.3" />
            {[0, 60, 120, 180, 240, 300].map((deg) => {
              const rad = (deg * Math.PI) / 180;
              const x1 = 100 + 34 * Math.cos(rad), y1 = 72 + 34 * Math.sin(rad);
              const x2 = 100 + 52 * Math.cos(rad), y2 = 72 + 52 * Math.sin(rad);
              return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth="1.5" opacity="0.4" />;
            })}
          </g>
        );
    }
  };
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity: 0.35 }}>
      <svg viewBox="0 0 200 160" className="w-3/4 max-w-[300px]" style={{ transform: flip ? "scaleX(-1)" : undefined }}>
        {content()}
      </svg>
    </div>
  );
};

// ─── Proximity Ring ───────────────────────────────────────────────────────────

const ProximityRing = ({ status, pct }: { status: ProximityStatus; pct: number }) => {
  const cfg: Record<ProximityStatus, { color: string; label: string }> = {
    unknown:   { color: "#9ca3af", label: "Analysing…" },
    too_far:   { color: "#f87171", label: "Get closer →" },
    good:      { color: "#4ade80", label: pct > 0 ? "Hold steady…" : "✓ Good distance" },
    too_close: { color: "#fb923c", label: "← Step back" },
    too_dark:  { color: "#facc15", label: "Find better lighting" },
  };
  const { color, label } = cfg[status];
  const r = 46, circ = 2 * Math.PI * r;
  const dash = circ * (1 - pct / 100);
  return (
    <div className="absolute bottom-28 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="4" opacity="0.25" />
        {status === "good" && pct > 0 && (
          <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="4"
            strokeDasharray={circ} strokeDashoffset={dash} strokeLinecap="round"
            transform="rotate(-90 50 50)" className="transition-all duration-300" />
        )}
        <circle cx="50" cy="50" r="6" fill={color} opacity="0.7" />
      </svg>
      <div className="text-xs font-medium px-2 py-0.5 rounded-full"
        style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}>
        {label}
      </div>
    </div>
  );
};

// ─── Top-Down Position Map ────────────────────────────────────────────────────

const PositionMap = ({ shotIdx }: { shotIdx: number }) => {
  const shot = SHOTS[shotIdx];
  const dots = [
    { id: 1, cx: 50, cy: 10 },
    { id: 2, cx: 20, cy: 22 },
    { id: 3, cx: 8,  cy: 50 },
    { id: 4, cx: 20, cy: 78 },
    { id: 5, cx: 50, cy: 90 },
    { id: 6, cx: 80, cy: 78 },
    { id: 7, cx: 92, cy: 50 },
    { id: 8, cx: 80, cy: 22 },
  ];
  return (
    <div className="w-20 h-20">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <rect x="30" y="15" width="40" height="70" rx="10" fill="none" stroke="white" strokeWidth="1.5" opacity="0.4" />
        {([[32,25],[32,68],[68,25],[68,68]] as [number,number][]).map(([wx,wy],i) => (
          <rect key={i} x={wx-3} y={wy-5} width="6" height="10" rx="2" fill="white" opacity="0.2" />
        ))}
        {shot.stage === "overview" && dots.map(d => (
          <circle key={d.id} cx={d.cx} cy={d.cy} r={d.id === shot.id ? 5 : 3}
            fill={d.id === shot.id ? "#60a5fa" : d.id < shot.id ? "#4ade80" : "white"}
            opacity={d.id === shot.id ? 1 : d.id < shot.id ? 0.7 : 0.3} />
        ))}
        {shot.stage === "overview" && (() => {
          const dot = dots.find(d => d.id === shot.id);
          if (!dot) return null;
          return <line x1="50" y1="50" x2={dot.cx} y2={dot.cy} stroke="#60a5fa" strokeWidth="1.5" opacity="0.6" strokeDasharray="3 2" />;
        })()}
        {shot.stage !== "overview" && (
          <text x="50" y="55" textAnchor="middle" fill="white" fontSize="20" opacity="0.5">
            {shot.stage === "wheels" ? "⚙" : "🔍"}
          </text>
        )}
      </svg>
    </div>
  );
};

// ─── Intro Screen ─────────────────────────────────────────────────────────────

const IntroScreen = ({ inspectionType, onStart, onCancel }: { inspectionType: string; onStart: () => void; onCancel: () => void }) => (
  <div className="fixed inset-0 bg-background z-50 flex flex-col">
    <div className="flex items-center justify-between p-4 border-b border-border">
      <Button variant="ghost" size="icon" onClick={onCancel}>
        <X className="w-5 h-5" />
      </Button>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {inspectionType.replace("-", " ")} Inspection
      </h2>
      <div className="w-10" />
    </div>

    <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center gap-6">
      <div className="text-5xl">📸</div>

      <div className="text-center">
        <h1 className="text-xl font-bold text-foreground">Vehicle Scan</h1>
        <p className="text-sm text-muted-foreground mt-1">
          We'll guide you through 18 shots in about 2 minutes. The app tells you exactly where to stand.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        {[
          { stage: "overview", desc: "8 positions around the car" },
          { stage: "detail",   desc: "6 close-ups of panels & sills" },
          { stage: "wheels",   desc: "4 wheel close-ups" },
        ].map(({ stage, desc }) => {
          const s = stage as Stage;
          const m = STAGE_META[s];
          return (
            <div key={stage} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border">
              <span className="text-xl">{m.emoji}</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Stage {m.num} — {m.label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <span className="text-xs font-mono text-muted-foreground">{m.count}</span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <AlertCircle className="w-3.5 h-3.5" />
        Live capture only — all photos are taken in real time
      </div>

      <Button className="w-full max-w-sm" size="lg" onClick={onStart}>
        Start Scan <ChevronRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  </div>
);

// ─── Stage Complete Screen ────────────────────────────────────────────────────

const StageCompleteScreen = ({ completedStage, nextStage, onContinue }: { completedStage: Stage; nextStage: Stage; onContinue: () => void }) => {
  const next = STAGE_META[nextStage];
  const hints: Record<Stage, string[]> = {
    overview: [],
    detail: [
      "Crouch or bend down for bumper and sill shots",
      "Get 40–60 cm from the surface",
      "The closer you are, the more detail the AI can see",
    ],
    wheels: [
      "Crouch at tyre level for each wheel",
      "Centre the entire rim in frame",
      "30–50 cm from the wheel is ideal",
    ],
  };
  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center p-6 gap-6">
      <div className="text-5xl">✅</div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-foreground">Stage {STAGE_META[completedStage].num} complete!</h2>
        <p className="text-sm text-muted-foreground mt-1">Great work — overview shots captured.</p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 border border-border">
          <span className="text-2xl">{next.emoji}</span>
          <div>
            <p className="text-sm font-semibold text-foreground">Next: Stage {next.num} — {next.label}</p>
            <p className="text-xs text-muted-foreground">{next.count} shots</p>
          </div>
        </div>
        {hints[nextStage].length > 0 && (
          <div className="space-y-1.5 pl-2">
            {hints[nextStage].map((h, i) => (
              <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className="text-primary">•</span>{h}
              </p>
            ))}
          </div>
        )}
      </div>

      <Button className="w-full max-w-sm" size="lg" onClick={onContinue}>
        Continue <ChevronRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );
};

// ─── Review Screen ────────────────────────────────────────────────────────────

const ReviewScreen = ({ photos, onSave, onRetake, saving }: {
  photos: Record<number, string>;
  onSave: () => void;
  onRetake: (id: number) => void;
  saving: boolean;
}) => (
  <div className="fixed inset-0 bg-background z-50 flex flex-col">
    <div className="flex items-center gap-3 p-4 border-b border-border">
      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
        <Check className="w-4 h-4 text-primary" />
      </div>
      <h2 className="text-sm font-semibold text-foreground">Review — {Object.keys(photos).length}/18 Shots</h2>
      <div className="flex-1" />
    </div>

    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      {STAGES.map(stage => (
        <div key={stage}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {STAGE_META[stage].emoji} {STAGE_META[stage].label}
          </h3>
          <div className="grid grid-cols-4 gap-2">
            {SHOTS.filter(s => s.stage === stage).map(shot => (
              <div key={shot.id} className="relative aspect-[3/4] rounded-md overflow-hidden bg-muted cursor-pointer" onClick={() => onRetake(shot.id)}>
                {photos[shot.id] ? (
                  <>
                    <img src={photos[shot.id]} alt={shot.label} className="w-full h-full object-cover" />
                    <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-green-500/80 flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Camera className="w-5 h-5 text-muted-foreground opacity-40" />
                  </div>
                )}
                <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5">
                  <p className="text-[9px] text-white truncate text-center">{shot.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>

    <div className="p-4 border-t border-border">
      <Button className="w-full" size="lg" onClick={onSave} disabled={saving}>
        {saving ? "Uploading…" : <><Check className="w-4 h-4 mr-1" /> Submit Inspection</>}
      </Button>
    </div>
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

interface InspectionCaptureFlowProps {
  vehicleId: string;
  inspectionType: "check-in" | "check-out";
  onComplete: () => void;
  onCancel: () => void;
}

const InspectionCaptureFlow = ({ vehicleId, inspectionType, onComplete, onCancel }: InspectionCaptureFlowProps) => {
  const [appState, setAppState]         = useState<AppState>("intro");
  const [shotIdx, setShotIdx]           = useState(0);
  const [photos, setPhotos]             = useState<Record<number, string>>({});
  const [previewUrl, setPreviewUrl]     = useState<string | null>(null);
  const [proximity, setProximity]       = useState<ProximityStatus>("unknown");
  const [, setStableCount]              = useState(0);
  const [countdownPct, setCountdownPct] = useState(0);
  const [cameraReady, setCameraReady]   = useState(false);
  const [flash, setFlash]               = useState(false);

  const videoRef      = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const probeRef      = useRef<HTMLCanvasElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const { user }  = useAuth();
  const { toast } = useToast();

  const currentShot = SHOTS[shotIdx];
  const currentStage = currentShot?.stage;

  const startCamera = useCallback(async () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setCameraReady(true);
      }
    } catch {
      toast({ title: "Camera Error", description: "Allow camera access to continue.", variant: "destructive" });
    }
  }, [toast]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  useEffect(() => {
    if (appState === "capturing") startCamera();
    else stopCamera();
    return () => stopCamera();
  }, [appState, startCamera, stopCamera]);

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const ts = new Date().toISOString().replace("T", " ").split(".")[0];
    ctx.font = `${Math.round(canvas.width * 0.012)}px monospace`;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(`LIVE CAPTURE · ${ts}`, canvas.width * 0.01, canvas.height * 0.975);
    return canvas.toDataURL("image/jpeg", 0.92);
  }, []);

  const triggerCapture = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    const frame = captureFrame();
    if (!frame) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    stopCamera();
    setProximity("unknown");
    setCountdownPct(0);
    setPreviewUrl(frame);
    setAppState("preview");
  }, [captureFrame, stopCamera]);

  useEffect(() => {
    if (appState !== "capturing" || !cameraReady) return;
    let stable = 0;

    intervalRef.current = setInterval(() => {
      if (!videoRef.current || !probeRef.current) return;
      const status = analyzeFrame(videoRef.current, probeRef.current, currentShot.target);
      setProximity(status);

      if (status === "good") {
        stable++;
        const pct = Math.min(100, (stable / 4) * 100);
        setStableCount(stable);
        setCountdownPct(pct);
        if (stable >= 4) {
          stable = 0;
          triggerCapture();
        }
      } else {
        stable = 0;
        setStableCount(0);
        setCountdownPct(0);
      }
    }, 500);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState, cameraReady, shotIdx]);

  const handleManualCapture = () => {
    if (appState !== "capturing" || !cameraReady) return;
    triggerCapture();
  };

  const acceptPhoto = () => {
    if (!previewUrl || !currentShot) return;
    const updated = { ...photos, [currentShot.id]: previewUrl };
    setPhotos(updated);
    setPreviewUrl(null);

    const nextIdx = shotIdx + 1;

    if (nextIdx >= SHOTS.length) {
      setAppState("review");
      return;
    }

    const nextStage = SHOTS[nextIdx].stage;
    if (nextStage !== currentStage) {
      setShotIdx(nextIdx);
      setAppState("stage_complete");
    } else {
      setShotIdx(nextIdx);
      setAppState("capturing");
    }
  };

  const retakePhoto = () => {
    setPreviewUrl(null);
    setAppState("capturing");
  };

  const retakeSpecific = (id: number) => {
    const idx = SHOTS.findIndex(s => s.id === id);
    if (idx < 0) return;
    setShotIdx(idx);
    setAppState("capturing");
  };

  const dataUrlToBlob = (dataUrl: string): Blob => {
    const [header, b64] = dataUrl.split(",");
    const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };

  const saveInspection = async () => {
    if (!user) return;
    setAppState("saving");
    try {
      const { data: insp, error: inspErr } = await supabase
        .from("inspections")
        .insert({
          vehicle_id: vehicleId,
          inspection_type: inspectionType,
          status: "pending",
          notes: `${inspectionType === "check-out" ? "Check-out" : "Check-in"} — ${Object.keys(photos).length} photos (3-stage scan)`,
        })
        .select().single();

      if (inspErr || !insp) throw inspErr;

      for (const [idStr, dataUrl] of Object.entries(photos)) {
        const shotId  = Number(idStr);
        const shot    = SHOTS.find(s => s.id === shotId)!;
        const label   = `${shot.stage.charAt(0).toUpperCase() + shot.stage.slice(1)} - ${shot.label}`;
        const blob    = dataUrlToBlob(dataUrl);
        const path    = `${user.id}/${insp.id}/shot-${idStr}.jpg`;

        const { error: uploadErr } = await supabase.storage.from("inspection-photos").upload(path, blob, { contentType: "image/jpeg" });
        if (uploadErr) throw uploadErr;

        const { data: urlData } = supabase.storage.from("inspection-photos").getPublicUrl(path);

        const { error: photoErr } = await supabase.from("inspection_photos").insert({
          inspection_id:   insp.id,
          position_number: shotId,
          position_name:   label,
          photo_url:       urlData.publicUrl,
        });
        if (photoErr) throw photoErr;
      }

      toast({ title: "Scan submitted!", description: "AI analysis is running in the background." });
      onComplete();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.message, variant: "destructive" });
      setAppState("review");
    }
  };

  // ─── Renders ──────────────────────────────────────────────────────────────

  if (appState === "intro") {
    return <IntroScreen inspectionType={inspectionType} onStart={() => setAppState("capturing")} onCancel={onCancel} />;
  }

  if (appState === "stage_complete" && currentShot) {
    const prevStage = SHOTS[shotIdx - 1]?.stage ?? "overview";
    return (
      <StageCompleteScreen
        completedStage={prevStage}
        nextStage={currentShot.stage}
        onContinue={() => setAppState("capturing")}
      />
    );
  }

  if (appState === "review") {
    return <ReviewScreen photos={photos} onSave={saveInspection} onRetake={retakeSpecific} saving={false} />;
  }

  if (appState === "saving") {
    return (
      <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Uploading {Object.keys(photos).length} photos…</p>
      </div>
    );
  }

  if (!currentShot) return null;

  const stageShotsTotal  = SHOTS.filter(s => s.stage === currentStage).length;
  const stageFirstIdx    = SHOTS.findIndex(s => s.stage === currentStage);
  const stageProgress    = shotIdx - stageFirstIdx + 1;
  const meta             = STAGE_META[currentStage];
  const totalDone        = Object.keys(photos).length;

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={probeRef} className="hidden" />

      {flash && <div className="absolute inset-0 bg-white z-50 pointer-events-none animate-pulse" />}

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 p-4 flex items-start gap-3" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)" }}>
        <Button variant="ghost" size="icon" className="text-white shrink-0" onClick={() => { stopCamera(); setAppState("intro"); onCancel(); }}>
          <X className="w-5 h-5" />
        </Button>

        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/10 text-xs font-medium text-white mb-1">
            <span>{meta.emoji}</span>
            <span>{meta.label}</span>
          </div>
          <p className="text-white text-sm font-semibold truncate">{currentShot.instruction}</p>
          <p className="text-white/60 text-xs truncate">{currentShot.hint}</p>
        </div>

        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/10 text-xs text-white font-mono">
          <span>{totalDone + (previewUrl ? 1 : 0)}/18</span>
          <div className="w-12 h-1.5 rounded-full bg-white/20 overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((totalDone + (previewUrl ? 1 : 0)) / 18) * 100}%` }} />
          </div>
        </div>
      </div>

      {/* Camera / Preview */}
      <div className="flex-1 relative overflow-hidden">
        {appState === "preview" && previewUrl ? (
          <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            {cameraReady && (
              <>
                <ShotGuide angle={currentShot.viewAngle} flip={currentShot.flip} />
                <ProximityRing status={proximity} pct={countdownPct} />
              </>
            )}
            <div className="absolute top-16 right-3 z-10 opacity-80">
              <PositionMap shotIdx={shotIdx} />
            </div>
            <div className="absolute bottom-2 left-4 right-4 z-10">
              <div className="h-1 rounded-full bg-white/20 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${(stageProgress / stageShotsTotal) * 100}%`, backgroundColor: meta.ring }} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bottom Bar */}
      <div className="bg-black/90 px-4 py-5">
        {appState === "preview" ? (
          <div className="flex items-center justify-center gap-6">
            <Button variant="outline" size="lg" onClick={retakePhoto} className="border-white/20 text-white hover:bg-white/10">
              <RotateCcw className="w-4 h-4 mr-1" /> Retake
            </Button>
            <Button size="lg" onClick={acceptPhoto}>
              <Check className="w-4 h-4 mr-1" />
              {shotIdx + 1 >= SHOTS.length ? "Review All" : "Next"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-1.5">
              {SHOTS.filter(s => s.stage === currentStage).map((s, i) => (
                <div key={s.id} className="w-2 h-2 rounded-full transition-all"
                  style={{ backgroundColor: i < stageProgress - 1 ? meta.ring : i === stageProgress - 1 ? "white" : "rgba(255,255,255,0.2)" }} />
              ))}
            </div>
            <button onClick={handleManualCapture} className="relative w-16 h-16 rounded-full border-4 border-white/80 flex items-center justify-center active:scale-95 transition-transform">
              <div className="w-12 h-12 rounded-full bg-white" />
              {countdownPct > 0 && (
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="30" fill="none" stroke={meta.ring} strokeWidth="3"
                    strokeDasharray={`${2 * Math.PI * 30}`} strokeDashoffset={`${2 * Math.PI * 30 * (1 - countdownPct / 100)}`}
                    strokeLinecap="round" className="transition-all duration-300" />
                </svg>
              )}
            </button>
            <p className="text-white/40 text-[10px]">Tap to capture · or hold steady to auto-capture</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default InspectionCaptureFlow;
