import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Camera, X, Check, RotateCcw, ChevronRight, AlertCircle, RotateCw } from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

type Stage       = "overview" | "detail" | "wheels";
type ViewAngle   = "front" | "rear" | "side" | "corner" | "low" | "wheel";

type FlowState =
  | "intro"
  | "position"
  | "capture"
  | "preview"
  | "stage_done"
  | "review"
  | "saving";

interface ShotDef {
  id: number;
  stage: Stage;
  label: string;
  instruction: string;
  distanceHint: string;
  viewAngle: ViewAngle;
  flip?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHOT DEFINITIONS (18 shots)
   ═══════════════════════════════════════════════════════════════════════════ */

const SHOTS: ShotDef[] = [
  { id: 1,  stage: "overview", label: "Front",              instruction: "Stand in front of the car",       distanceHint: "3–4 metres away — whole front visible", viewAngle: "front" },
  { id: 2,  stage: "overview", label: "Front-Left Corner",  instruction: "Walk to the front-left corner",   distanceHint: "3–4 metres — see front AND left side",  viewAngle: "corner" },
  { id: 3,  stage: "overview", label: "Left Side",          instruction: "Stand along the left side",       distanceHint: "Step back until the whole side fits",   viewAngle: "side" },
  { id: 4,  stage: "overview", label: "Rear-Left Corner",   instruction: "Walk to the rear-left corner",    distanceHint: "3–4 metres — see rear AND left side",   viewAngle: "corner", flip: true },
  { id: 5,  stage: "overview", label: "Rear",               instruction: "Stand behind the car",            distanceHint: "3–4 metres — whole rear visible",       viewAngle: "rear" },
  { id: 6,  stage: "overview", label: "Rear-Right Corner",  instruction: "Walk to the rear-right corner",   distanceHint: "3–4 metres — see rear AND right side",  viewAngle: "corner" },
  { id: 7,  stage: "overview", label: "Right Side",         instruction: "Stand along the right side",      distanceHint: "Step back until the whole side fits",   viewAngle: "side", flip: true },
  { id: 8,  stage: "overview", label: "Front-Right Corner", instruction: "Walk to the front-right corner",  distanceHint: "3–4 metres — see front AND right side", viewAngle: "corner", flip: true },

  { id: 9,  stage: "detail", label: "Front Bumper",       instruction: "Crouch at the front of the car",  distanceHint: "40–60 cm away, phone at bumper height",  viewAngle: "low" },
  { id: 10, stage: "detail", label: "Left Door Panels",   instruction: "Stand close to the left doors",   distanceHint: "50 cm away — door surface fills frame",  viewAngle: "side" },
  { id: 11, stage: "detail", label: "Left Sill",          instruction: "Crouch along the left side",      distanceHint: "40–60 cm — shoot along the bottom edge", viewAngle: "low" },
  { id: 12, stage: "detail", label: "Right Door Panels",  instruction: "Stand close to the right doors",  distanceHint: "50 cm away — door surface fills frame",  viewAngle: "side", flip: true },
  { id: 13, stage: "detail", label: "Right Sill",         instruction: "Crouch along the right side",     distanceHint: "40–60 cm — shoot along the bottom edge", viewAngle: "low", flip: true },
  { id: 14, stage: "detail", label: "Rear Bumper",        instruction: "Crouch at the rear of the car",   distanceHint: "40–60 cm away, phone at bumper height",  viewAngle: "low", flip: true },

  { id: 15, stage: "wheels", label: "Front-Left Wheel",   instruction: "Crouch at the front-left wheel",  distanceHint: "30–50 cm — centre the wheel rim",  viewAngle: "wheel" },
  { id: 16, stage: "wheels", label: "Rear-Left Wheel",    instruction: "Crouch at the rear-left wheel",   distanceHint: "30–50 cm — centre the wheel rim",  viewAngle: "wheel" },
  { id: 17, stage: "wheels", label: "Rear-Right Wheel",   instruction: "Crouch at the rear-right wheel",  distanceHint: "30–50 cm — centre the wheel rim",  viewAngle: "wheel" },
  { id: 18, stage: "wheels", label: "Front-Right Wheel",  instruction: "Crouch at the front-right wheel", distanceHint: "30–50 cm — centre the wheel rim",  viewAngle: "wheel" },
];

const STAGE_META: Record<Stage, { num: number; label: string; color: string; bg: string; count: number; desc: string }> = {
  overview: { num: 1, label: "Overview",     color: "#60a5fa", bg: "bg-blue-500/15",    count: 8, desc: "Walk around the car" },
  detail:   { num: 2, label: "Detail Scan",  color: "#fbbf24", bg: "bg-amber-500/15",   count: 6, desc: "Close-up panels & bumpers" },
  wheels:   { num: 3, label: "Wheel Check",  color: "#34d399", bg: "bg-emerald-500/15", count: 4, desc: "Each wheel close-up" },
};

const STAGES: Stage[] = ["overview", "detail", "wheels"];

/* ═══════════════════════════════════════════════════════════════════════════
   POSITION DIAGRAM
   ═══════════════════════════════════════════════════════════════════════════ */

const PositionDiagram = ({ shot }: { shot: ShotDef }) => {
  if (shot.stage === "overview") {
    const positions: Record<number, { x: number; y: number; label: string }> = {
      1: { x: 50, y: 5,  label: "YOU" },
      2: { x: 12, y: 15, label: "YOU" },
      3: { x: 3,  y: 50, label: "YOU" },
      4: { x: 12, y: 85, label: "YOU" },
      5: { x: 50, y: 95, label: "YOU" },
      6: { x: 88, y: 85, label: "YOU" },
      7: { x: 97, y: 50, label: "YOU" },
      8: { x: 88, y: 15, label: "YOU" },
    };
    const pos = positions[shot.id];
    return (
      <svg viewBox="0 0 100 100" className="w-full h-full max-w-[280px] mx-auto">
        <rect x="35" y="20" width="30" height="60" rx="8" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" opacity="0.5" />
        {[[31,24],[31,70],[69,24],[69,70]].map(([wx,wy],i) => (
          <rect key={i} x={wx} y={wy} width="4" height="10" rx="1.5" fill="hsl(var(--muted-foreground))" opacity="0.3" />
        ))}
        <text x="50" y="18" textAnchor="middle" fontSize="5" fill="hsl(var(--muted-foreground))" opacity="0.5">FRONT</text>
        <text x="50" y="86" textAnchor="middle" fontSize="5" fill="hsl(var(--muted-foreground))" opacity="0.5">REAR</text>
        {pos && <>
          <circle cx={pos.x} cy={pos.y} r="5" fill="hsl(var(--primary))" opacity="0.9" />
          <text x={pos.x} y={pos.y + 1.5} textAnchor="middle" fontSize="3.5" fill="white" fontWeight="bold">{pos.label}</text>
          <line x1={pos.x} y1={pos.y} x2={50} y2={50} stroke="hsl(var(--primary))" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.4" />
        </>}
      </svg>
    );
  }

  if (shot.stage === "detail") {
    return (
      <svg viewBox="0 0 100 60" className="w-full h-full max-w-[280px] mx-auto">
        {shot.viewAngle === "side" ? (
          <g>
            <rect x="10" y="15" width="80" height="30" rx="5" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" opacity="0.4" />
            <circle cx="25" cy="45" r="7" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" opacity="0.3" />
            <circle cx="75" cy="45" r="7" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" opacity="0.3" />
            <rect x="30" y="18" width="35" height="24" rx="2" fill="hsl(var(--primary))" opacity="0.15" stroke="hsl(var(--primary))" strokeWidth="1" strokeDasharray="3,2" />
            <text x="47" y="32" textAnchor="middle" fontSize="4" fill="hsl(var(--primary))" fontWeight="bold">TARGET AREA</text>
          </g>
        ) : (
          <g>
            <rect x="15" y="10" width="70" height="15" rx="4" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" opacity="0.4" />
            <rect x="20" y="25" width="60" height="8" rx="2" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" opacity="0.3" />
            <rect x="18" y="22" width="64" height="14" rx="2" fill="hsl(var(--primary))" opacity="0.15" stroke="hsl(var(--primary))" strokeWidth="1" strokeDasharray="3,2" />
            <text x="50" y="30" textAnchor="middle" fontSize="3.5" fill="hsl(var(--primary))" fontWeight="bold">PHONE AT THIS HEIGHT</text>
            <line x1="50" y1="50" x2="50" y2="36" stroke="hsl(var(--primary))" strokeWidth="0.8" opacity="0.6" />
            <circle cx="50" cy="52" r="3" fill="hsl(var(--primary))" opacity="0.3" />
          </g>
        )}
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full max-w-[200px] mx-auto">
      <circle cx="50" cy="50" r="35" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="2" opacity="0.4" />
      <circle cx="50" cy="50" r="20" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" opacity="0.3" />
      <circle cx="50" cy="50" r="6" fill="hsl(var(--muted-foreground))" opacity="0.2" />
      {[0, 72, 144, 216, 288].map(deg => {
        const rad = (deg * Math.PI) / 180;
        return (
          <line key={deg} x1={50 + 8 * Math.cos(rad)} y1={50 + 8 * Math.sin(rad)} x2={50 + 18 * Math.cos(rad)} y2={50 + 18 * Math.sin(rad)} stroke="hsl(var(--muted-foreground))" strokeWidth="3" opacity="0.2" strokeLinecap="round" />
        );
      })}
      <text x="50" y="94" textAnchor="middle" fontSize="5" fill="hsl(var(--primary))" fontWeight="bold">CENTRE THE WHEEL</text>
    </svg>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   FRAMING BRACKETS
   ═══════════════════════════════════════════════════════════════════════════ */

const FramingBrackets = ({ stage }: { stage: Stage }) => {
  const inset = stage === "overview" ? "12%" : stage === "detail" ? "6%" : "15%";
  const color = STAGE_META[stage].color;

  if (stage === "wheels") {
    return (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <div className="w-[65%] aspect-square rounded-full border-[3px] border-dashed" style={{ borderColor: color, opacity: 0.6 }} />
        <div className="absolute bottom-[18%] left-0 right-0 text-center">
          <span className="text-xs px-3 py-1 rounded-full bg-black/50 text-white">Fit wheel inside circle</span>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute pointer-events-none z-10" style={{ inset }}>
      {[
        "top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-lg",
        "top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-lg",
        "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-lg",
        "bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-lg",
      ].map((cls, i) => (
        <div key={i} className={`absolute w-8 h-8 ${cls}`} style={{ borderColor: color, opacity: 0.7 }} />
      ))}
      <div className="absolute bottom-[-28px] left-0 right-0 text-center">
        <span className="text-xs px-3 py-1 rounded-full bg-black/50 text-white">
          {stage === "overview" ? "Fit the car inside the brackets" : "Fill the frame with the panel"}
        </span>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   SHOT SILHOUETTE OVERLAY
   ═══════════════════════════════════════════════════════════════════════════ */

const ShotSilhouette = ({ angle, flip }: { angle: ViewAngle; flip?: boolean }) => {
  const g = () => {
    switch (angle) {
      case "front":
      case "rear":
        return (
          <g>
            <rect x="25" y="30" width="50" height="35" rx="8" stroke="white" strokeWidth="1" fill="none" />
            <circle cx="35" cy="65" r="8" stroke="white" strokeWidth="0.8" fill="none" />
            <circle cx="65" cy="65" r="8" stroke="white" strokeWidth="0.8" fill="none" />
          </g>
        );
      case "side":
        return (
          <g>
            <rect x="10" y="35" width="80" height="25" rx="5" stroke="white" strokeWidth="1" fill="none" />
            <circle cx="25" cy="60" r="7" stroke="white" strokeWidth="0.8" fill="none" />
            <circle cx="75" cy="60" r="7" stroke="white" strokeWidth="0.8" fill="none" />
            <path d="M25,35 L35,22 L65,22 L75,35" stroke="white" strokeWidth="0.8" fill="none" />
          </g>
        );
      case "corner":
        return (
          <g>
            <path d="M15,60 L15,35 Q15,28 22,25 L70,25 Q78,25 80,32 L85,55 Q85,62 78,65 L22,65 Q15,65 15,60Z" stroke="white" strokeWidth="1" fill="none" />
            <circle cx="25" cy="65" r="6" stroke="white" strokeWidth="0.8" fill="none" />
            <circle cx="78" cy="65" r="6" stroke="white" strokeWidth="0.8" fill="none" />
          </g>
        );
      case "low":
        return (
          <g>
            <rect x="15" y="20" width="70" height="40" rx="5" stroke="white" strokeWidth="1" fill="none" />
            <rect x="20" y="60" width="60" height="12" rx="3" stroke="white" strokeWidth="0.8" fill="none" />
          </g>
        );
      case "wheel":
        return (
          <g>
            <circle cx="50" cy="50" r="30" stroke="white" strokeWidth="1" fill="none" />
          </g>
        );
    }
  };
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[5] opacity-[0.12]">
      <svg viewBox="0 0 100 100" className="w-[70%] h-[70%]" style={{ transform: flip ? "scaleX(-1)" : undefined }}>
        {g()}
      </svg>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   SUB-SCREENS
   ═══════════════════════════════════════════════════════════════════════════ */

const IntroScreen = ({ inspectionType, onStart, onCancel }: {
  inspectionType: string; onStart: () => void; onCancel: () => void;
}) => (
  <div className="fixed inset-0 z-50 bg-background flex flex-col">
    <div className="flex items-center justify-between p-4 border-b border-border">
      <Button variant="ghost" size="icon" onClick={onCancel}><X className="h-5 w-5" /></Button>
      <h2 className="text-lg font-semibold capitalize">{inspectionType.replace("-", " ")} Inspection</h2>
      <div className="w-10" />
    </div>

    <div className="flex-1 overflow-auto p-6 flex flex-col items-center justify-center gap-6">
      <div className="text-center space-y-3">
        <div className="text-5xl">📸</div>
        <h1 className="text-2xl font-bold">Vehicle Scan</h1>
        <p className="text-muted-foreground max-w-sm">
          We'll guide you step-by-step. Each shot shows you exactly where to stand and what to capture.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        {STAGES.map(s => {
          const m = STAGE_META[s];
          return (
            <div key={s} className={`flex items-center gap-4 p-4 rounded-xl ${m.bg}`}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: m.color }}>
                {m.num}
              </div>
              <div className="flex-1">
                <p className="font-semibold">{m.label}</p>
                <p className="text-sm text-muted-foreground">{m.desc}</p>
              </div>
              <span className="text-sm font-medium text-muted-foreground">{m.count}</span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Camera className="h-4 w-4" />
        All photos are taken live — about 2 minutes total
      </div>

      <Button size="lg" className="w-full max-w-sm" onClick={onStart}>
        Start Scan <ChevronRight className="h-5 w-5 ml-1" />
      </Button>
    </div>
  </div>
);

const PositionCard = ({ shot, shotIdx, photos, onReady, onSkip, onCancel }: {
  shot: ShotDef; shotIdx: number; photos: Record<number, string>;
  onReady: () => void; onSkip: () => void; onCancel: () => void;
}) => {
  const meta        = STAGE_META[shot.stage];
  const stageStart  = SHOTS.findIndex(s => s.stage === shot.stage);
  const stagePos    = shotIdx - stageStart + 1;
  const totalDone   = Object.keys(photos).length;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <Button variant="ghost" size="icon" onClick={onCancel}>
          <X className="h-5 w-5" />
        </Button>
        <div className="text-center">
          <div className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${meta.color}20`, color: meta.color }}>
            {meta.label} · {stagePos} of {meta.count}
          </div>
        </div>
        <span className="text-sm font-medium text-muted-foreground">{totalDone}/18</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        <div className="w-full max-w-[280px] aspect-square">
          <PositionDiagram shot={shot} />
        </div>
        <div className="text-center space-y-2">
          <div className="inline-block px-4 py-2 rounded-xl" style={{ backgroundColor: `${meta.color}15` }}>
            <span className="text-xl font-bold" style={{ color: meta.color }}>{shot.label.toUpperCase()}</span>
          </div>
          <p className="text-lg font-medium">{shot.instruction}</p>
          <p className="text-sm text-muted-foreground">{shot.distanceHint}</p>
        </div>
      </div>

      <div className="p-4 space-y-3 border-t border-border">
        <Button size="lg" className="w-full" onClick={onReady}>
          <Camera className="h-5 w-5 mr-2" /> I'm in Position — Open Camera
        </Button>
        <Button variant="ghost" className="w-full text-muted-foreground" onClick={onSkip}>
          Skip this shot
        </Button>
      </div>
    </div>
  );
};

const StageDoneScreen = ({ completedStage, nextStage, onContinue }: {
  completedStage: Stage; nextStage: Stage; onContinue: () => void;
}) => {
  const done = STAGE_META[completedStage];
  const next = STAGE_META[nextStage];
  const tips: Record<Stage, string> = {
    overview: "",
    detail: "Get close to the panels — 40–60 cm away. Crouch for bumpers and sills.",
    wheels: "Crouch at each wheel. Centre the rim in frame, 30–50 cm away.",
  };
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center p-6 gap-8">
      <div className="text-center space-y-3">
        <div className="text-5xl">✅</div>
        <h2 className="text-2xl font-bold">{done.label} Done!</h2>
        <p className="text-muted-foreground">{done.count} shots captured</p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-4 p-4 rounded-xl" style={{ backgroundColor: `${next.color}15` }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{ backgroundColor: next.color }}>
            {next.num}
          </div>
          <div>
            <p className="font-semibold">Next: {next.label}</p>
            <p className="text-sm text-muted-foreground">{next.count} shots</p>
          </div>
        </div>
        {tips[nextStage] && (
          <p className="text-sm text-muted-foreground text-center">{tips[nextStage]}</p>
        )}
      </div>

      <Button size="lg" className="w-full max-w-sm" onClick={onContinue}>
        Continue <ChevronRight className="h-5 w-5 ml-1" />
      </Button>
    </div>
  );
};

const ReviewScreen = ({ photos, onSave, onRetake, saving }: {
  photos: Record<number, string>; onSave: () => void; onRetake: (id: number) => void; saving: boolean;
}) => {
  const count = Object.keys(photos).length;
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="p-4 border-b border-border text-center">
        <div className="flex items-center justify-center gap-2">
          <Check className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">{count} of 18 Photos Captured</h2>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {STAGES.map(stage => (
          <div key={stage}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: STAGE_META[stage].color }} />
              <span className="font-semibold text-sm">{STAGE_META[stage].label}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {SHOTS.filter(s => s.stage === stage).map(shot => (
                <button key={shot.id} className="relative aspect-[4/3] rounded-lg overflow-hidden border border-border" onClick={() => onRetake(shot.id)}>
                  {photos[shot.id] ? (
                    <>
                      <img src={photos[shot.id]} alt={shot.label} className="w-full h-full object-cover" />
                      <div className="absolute top-1 right-1">
                        <RotateCw className="h-3.5 w-3.5 text-white drop-shadow" />
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full bg-muted/50 flex flex-col items-center justify-center gap-1">
                      <AlertCircle className="h-4 w-4 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">Skipped</span>
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-0.5">
                    <span className="text-[10px] text-white leading-tight">{shot.label}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="p-4 border-t border-border space-y-2">
        <Button size="lg" className="w-full" onClick={onSave} disabled={saving || count < 10}>
          {saving ? "Uploading…" : <><Check className="h-5 w-5 mr-2" /> Submit Inspection ({count} photos)</>}
        </Button>
        {count < 10 && <p className="text-xs text-destructive text-center">Minimum 10 photos required</p>}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

interface Props {
  vehicleId: string;
  inspectionType: "check-in" | "check-out";
  onComplete: () => void;
  onCancel: () => void;
}

const InspectionCaptureFlow = ({ vehicleId, inspectionType, onComplete, onCancel }: Props) => {
  const [flowState, setFlowState] = useState<FlowState>("intro");
  const [shotIdx, setShotIdx]     = useState(0);
  const [photos, setPhotos]       = useState<Record<number, string>>({});
  const [previewUrl, setPreview]  = useState<string | null>(null);
  const [cameraReady, setCamReady]= useState(false);
  const [flash, setFlash]         = useState(false);

  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { user }  = useAuth();
  const { toast } = useToast();

  const shot      = SHOTS[shotIdx];
  const stage     = shot?.stage;
  const meta      = stage ? STAGE_META[stage] : null;

  const startCamera = useCallback(async () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setCamReady(true);
      }
    } catch {
      toast({ title: "Camera Error", description: "Please allow camera access.", variant: "destructive" });
    }
  }, [toast]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCamReady(false);
  }, []);

  useEffect(() => {
    if (flowState === "capture") { startCamera(); }
    else { stopCamera(); }
    return () => stopCamera();
  }, [flowState, startCamera, stopCamera]);

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const v = videoRef.current, c = canvasRef.current;
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0);
    const ts = new Date().toISOString().replace("T", " ").split(".")[0];
    const fontSize = Math.round(c.width * 0.013);
    ctx.font = `${fontSize}px monospace`;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(`LIVE · ${ts}`, c.width * 0.01, c.height * 0.98);
    return c.toDataURL("image/jpeg", 0.92);
  }, []);

  const handleCapture = () => {
    if (!cameraReady) return;
    const frame = captureFrame();
    if (!frame) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    stopCamera();
    setPreview(frame);
    setFlowState("preview");
  };

  const advanceToNext = () => {
    const next = shotIdx + 1;
    if (next >= SHOTS.length) {
      setFlowState("review");
      return;
    }
    const nextStage = SHOTS[next].stage;
    setShotIdx(next);
    if (nextStage !== stage) {
      setFlowState("stage_done");
    } else {
      setFlowState("position");
    }
  };

  const acceptPhoto = () => {
    if (!previewUrl || !shot) return;
    setPhotos(p => ({ ...p, [shot.id]: previewUrl }));
    setPreview(null);
    advanceToNext();
  };

  const retakePhoto = () => {
    setPreview(null);
    setFlowState("capture");
  };

  const skipShot = () => advanceToNext();

  const retakeSpecific = (id: number) => {
    const idx = SHOTS.findIndex(s => s.id === id);
    if (idx < 0) return;
    setShotIdx(idx);
    setFlowState("position");
  };

  const [saving, setSaving] = useState(false);

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
    setSaving(true);
    setFlowState("saving");
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

      const entries = Object.entries(photos);
      let savedCount = 0;

      for (const [idStr, dataUrl] of entries) {
        const s     = SHOTS.find(x => x.id === Number(idStr))!;
        const label = `${s.stage.charAt(0).toUpperCase() + s.stage.slice(1)} - ${s.label}`;
        const blob  = dataUrlToBlob(dataUrl);
        const path  = `${user.id}/${insp.id}/shot-${idStr}.jpg`;

        const { error: upErr } = await supabase.storage.from("inspection-photos").upload(path, blob, { contentType: "image/jpeg" });
        if (upErr) throw new Error(`Upload failed for shot ${idStr} (${label}): ${upErr.message}`);

        const { data: urlData } = supabase.storage.from("inspection-photos").getPublicUrl(path);
        const { error: phErr } = await supabase.from("inspection_photos").insert({
          inspection_id: insp.id, position_number: Number(idStr),
          position_name: label, photo_url: urlData.publicUrl,
        });
        if (phErr) {
          // Clean up the uploaded file since the DB row failed
          await supabase.storage.from("inspection-photos").remove([path]);
          throw new Error(`Save failed for shot ${idStr} (${label}): ${phErr.message}`);
        }
        savedCount++;
      }

      toast({ title: "Scan submitted!", description: "AI analysis running in background." });
      onComplete();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.message, variant: "destructive" });
      setFlowState("review");
    } finally {
      setSaving(false);
    }
  };

  // ─── RENDERS ────────────────────────────────────────────────────────────

  if (flowState === "intro") {
    return <IntroScreen inspectionType={inspectionType} onStart={() => setFlowState("position")} onCancel={onCancel} />;
  }

  if (flowState === "position" && shot) {
    return (
      <PositionCard shot={shot} shotIdx={shotIdx} photos={photos}
        onReady={() => setFlowState("capture")}
        onSkip={skipShot}
        onCancel={onCancel}
      />
    );
  }

  if (flowState === "stage_done" && shot) {
    const prevStage = SHOTS[shotIdx - 1]?.stage ?? "overview";
    return <StageDoneScreen completedStage={prevStage as Stage} nextStage={shot.stage} onContinue={() => setFlowState("position")} />;
  }

  if (flowState === "review") {
    return <ReviewScreen photos={photos} onSave={saveInspection} onRetake={retakeSpecific} saving={saving} />;
  }

  if (flowState === "saving") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-lg font-medium">Uploading {Object.keys(photos).length} photos…</p>
      </div>
    );
  }

  // ── CAPTURE / PREVIEW SCREEN ──────────────────────────────────────────

  if (!shot || !meta) return null;

  const stageStart = SHOTS.findIndex(s => s.stage === stage);
  const stagePos   = shotIdx - stageStart + 1;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <canvas ref={canvasRef} className="hidden" />

      {flash && <div className="absolute inset-0 z-50 bg-white animate-pulse pointer-events-none" />}

      <div className="absolute top-0 left-0 right-0 z-30 flex items-start justify-between p-3 bg-gradient-to-b from-black/60 to-transparent">
        <Button variant="ghost" size="icon" className="text-white" onClick={() => { stopCamera(); setFlowState("position"); }}>
          <X className="h-5 w-5" />
        </Button>

        <div className="text-center">
          <div className="text-xs font-medium px-2 py-0.5 rounded-full bg-black/40 text-white mb-1" style={{ borderColor: meta.color }}>
            {meta.label} · {stagePos}/{meta.count}
          </div>
          <p className="text-white font-bold text-sm">{shot.label}</p>
        </div>

        <span className="text-white text-sm font-medium bg-black/40 px-2 py-1 rounded-full">{Object.keys(photos).length}/18</span>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {flowState === "preview" && previewUrl ? (
          <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            {cameraReady && (
              <>
                <FramingBrackets stage={stage!} />
                <ShotSilhouette angle={shot.viewAngle} flip={shot.flip} />
              </>
            )}
          </>
        )}

        {flowState === "capture" && cameraReady && (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center z-20">
            <div className="bg-black/60 backdrop-blur-sm rounded-full px-4 py-2">
              <p className="text-white text-xs font-medium">{shot.distanceHint}</p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-black p-4 pb-6">
        {flowState === "preview" ? (
          <div className="flex items-center justify-center gap-6">
            <Button variant="outline" size="lg" className="border-white/30 text-white" onClick={retakePhoto}>
              <RotateCcw className="h-4 w-4 mr-2" /> Retake
            </Button>
            <Button size="lg" onClick={acceptPhoto}>
              <Check className="h-4 w-4 mr-2" /> {shotIdx + 1 >= SHOTS.length ? "Review All" : "Accept & Next"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-1.5">
              {SHOTS.filter(s => s.stage === stage).map((s, i) => (
                <div key={s.id} className={`w-2 h-2 rounded-full ${photos[s.id] ? 'bg-primary' : i === stagePos - 1 ? 'bg-white' : 'bg-white/30'}`} />
              ))}
            </div>

            <button className="w-[72px] h-[72px] rounded-full border-4 border-white flex items-center justify-center active:scale-95 transition-transform" onClick={handleCapture} disabled={!cameraReady}>
              <div className="w-[58px] h-[58px] rounded-full bg-white" />
            </button>

            <p className="text-white/60 text-xs">Tap to capture</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default InspectionCaptureFlow;
