

## Plan: Bounding Box Coordinate System

### Overview
Replace the point-based damage coordinate system (damage_x/y_percent) with a proper bounding box system (bbox_ymin, bbox_xmin, bbox_ymax, bbox_xmax on a 0-1000 scale). The AI prompts ask for `[ymin, xmin, ymax, xmax]` arrays, and the UI renders rectangles instead of circles on the photo annotations.

### 1. Database Migration
Add four `smallint` columns to `damage_items`: `bbox_ymin`, `bbox_xmin`, `bbox_ymax`, `bbox_xmax`. Add range constraints (0-1000) and ordering constraints. Backfill existing rows from legacy `damage_x/y_percent` values.

Note: Per project guidelines, CHECK constraints with static ranges (0-1000) are safe since they are immutable — no time-based logic involved.

### 2. Edge Function (`analyse-damage/index.ts`)
Replace entirely with the provided code:
- **Prompts**: Ask for `bounding_box: [ymin, xmin, ymax, xmax]` (0-1000 integers) instead of `damage_x/y_percent`
- **Helpers**: `parseBoundingBox()` validates the array, `legacyPointToBox()` converts old-style responses
- **DB insert**: Maps bbox fields into the new columns, plus computes legacy `damage_x/y_percent` from the center point for backwards compatibility

### 3. Report Page (`InspectionReport.tsx`)
Replace entirely with the provided code (reconstructing proper JSX from the stripped paste):
- **DamageItem type**: Add `bbox_ymin/xmin/ymax/xmax` fields
- **`getBoundingBoxPercent()`**: Converts 0-1000 bbox → CSS % (left/top/width/height), with fallback chain: bbox → legacy point → text heuristic
- **`DamageBoundingBox` component**: Renders a rectangle overlay (not a circle) with severity-colored border, number label, "approx" indicator when imprecise, and hover tooltip
- **`DamageCard`**: Updated dual-view with bbox-aware zoom panel centering on the box center
- **Photo grid**: Uses `DamageBoundingBox` instead of `DamageMarker`
- **Summary section**: Shows precision count ("X of Y have precise bounding box locations")
- `severityColors` gets a `stroke` property for SVG use

### 4. Damage Results (`DamageResults.tsx`)
Replace with the provided code:
- Updated `DamageItem` interface with bbox fields
- Precision indicator badges (Crosshair icon + "Precise" vs MapPin icon + "Approx") on each item
- Summary line showing how many items have precise locations

### 5. Deploy
- Deploy updated `analyse-damage` edge function
- Existing scans without bbox data gracefully fall back to legacy positioning

### Files Modified
- New migration SQL for bbox columns
- `supabase/functions/analyse-damage/index.ts`
- `src/pages/InspectionReport.tsx`
- `src/components/DamageResults.tsx`

