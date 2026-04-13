import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, XCircle, ArrowLeft } from "lucide-react";

interface DamageItem {
  type: string;
  location_on_car: string;
  size_estimate?: string;
  severity: string;
  confidence_score?: number;
  repair_cost_estimate_aed?: number;
  description?: string;
  status: string;
  detected_by_model?: string;
  photo_position?: number;
}

interface DamageResultsProps {
  damageItems: DamageItem[];
  onClose: () => void;
}

const severityConfig: Record<string, { color: string; icon: typeof CheckCircle; label: string }> = {
  minor: {
    color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    icon: CheckCircle,
    label: "Minor",
  },
  moderate: {
    color: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    icon: AlertTriangle,
    label: "Moderate",
  },
  severe: {
    color: "bg-red-500/20 text-red-400 border-red-500/30",
    icon: XCircle,
    label: "Severe",
  },
};

const DamageResults = ({ damageItems, onClose }: DamageResultsProps) => {
  const confirmed = damageItems.filter((i) => i.status !== "rejected");
  const rejected = damageItems.filter((i) => i.status === "rejected");

  const grouped = {
    severe: confirmed.filter((i) => i.severity === "severe"),
    moderate: confirmed.filter((i) => i.severity === "moderate"),
    minor: confirmed.filter((i) => i.severity === "minor"),
  };

  const totalCost = confirmed.reduce(
    (sum, item) => sum + (item.repair_cost_estimate_aed || 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{confirmed.length}</p>
            <p className="text-xs text-muted-foreground">Items Found</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-400">{grouped.severe.length}</p>
            <p className="text-xs text-muted-foreground">Severe</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">{grouped.moderate.length}</p>
            <p className="text-xs text-muted-foreground">Moderate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400">{grouped.minor.length}</p>
            <p className="text-xs text-muted-foreground">Minor</p>
          </CardContent>
        </Card>
      </div>

      {/* Grouped damage items */}
      {(["severe", "moderate", "minor"] as const).map((severity) => {
        const items = grouped[severity];
        if (items.length === 0) return null;
        const config = severityConfig[severity];
        const Icon = config.icon;

        return (
          <div key={severity}>
            <div className="flex items-center gap-2 mb-3">
              <Icon className="h-4 w-4" />
              <h4 className="text-sm font-semibold uppercase tracking-wider">
                {config.label} ({items.length})
              </h4>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <Card key={idx}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{item.type}</p>
                          <Badge variant="outline" className={config.color}>
                            {config.label}
                          </Badge>
                          {item.status === "new" && (
                            <Badge variant="outline" className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                              New Find
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          📍 {item.location_on_car}
                          {item.size_estimate && ` · ${item.size_estimate}`}
                          {item.photo_position && ` · Position ${item.photo_position}`}
                        </p>
                        {item.description && (
                          <p className="text-sm text-muted-foreground">{item.description}</p>
                        )}
                        {item.confidence_score && (
                          <p className="text-xs text-muted-foreground">
                            Confidence: {item.confidence_score}%
                            {item.detected_by_model && ` · Detected by: ${item.detected_by_model}`}
                          </p>
                        )}
                      </div>
                      {item.repair_cost_estimate_aed ? (
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold">
                            {item.repair_cost_estimate_aed.toLocaleString()} AED
                          </p>
                          <p className="text-xs text-muted-foreground">Est. repair</p>
                        </div>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}

      {confirmed.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
            <p className="text-lg font-semibold">No Damage Detected</p>
            <p className="text-sm text-muted-foreground">The vehicle appears to be in good condition.</p>
          </CardContent>
        </Card>
      )}

      {/* Total cost */}
      {totalCost > 0 && (
        <Card className="border-primary/30">
          <CardContent className="p-4 flex items-center justify-between">
            <p className="text-sm font-medium">Total Estimated Repair Cost</p>
            <p className="text-xl font-bold text-primary">
              {totalCost.toLocaleString()} AED
            </p>
          </CardContent>
        </Card>
      )}

      {rejected.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {rejected.length} item(s) were flagged initially but rejected after review.
        </p>
      )}

      <Button variant="outline" onClick={onClose} className="gap-2 w-full">
        <ArrowLeft className="h-4 w-4" />
        Back to Vehicle
      </Button>
    </div>
  );
};

export default DamageResults;
