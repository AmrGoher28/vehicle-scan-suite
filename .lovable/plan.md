

## Plan: Apply Bounding Box Code Updates

The database migration is already complete. Now we apply the 3 frontend/edge-function file updates you provided.

### Step 1: Replace `supabase/functions/analyse-damage/index.ts`
Replace with your provided version featuring:
- Updated prompts requesting `bounding_box: [ymin, xmin, ymax, xmax]` (0-1000 scale)
- `parseBoundingBox()` returning individual column values
- `legacyPointToBox()` for backwards compatibility
- DB insert mapping bbox fields + computing legacy `damage_x/y_percent` from center

### Step 2: Replace `src/pages/InspectionReport.tsx`
Replace with your provided version featuring:
- `getBoundingBoxPercent()` with fallback chain (bbox → legacy point → text heuristic)
- `DamageBoundingBox` component rendering severity-colored rectangles with hover tooltips
- `DamageCard` with bbox-aware zoom panel
- Precision count indicator in summary section

### Step 3: Replace `src/components/DamageResults.tsx`
Replace with your provided version featuring:
- Updated `DamageItem` interface with bbox fields
- Precise/Approximate badges per item (Crosshair vs MapPin icons)
- Summary line showing precise location count

### Step 4: Replace `src/components/InspectionCaptureFlow.tsx`
Replace with your provided video walkaround + manual capture flow featuring:
- Mode selection screen (video vs manual)
- 8-zone guided video recording with coverage map, distance indicator, and auto frame extraction
- Manual 8-position photo fallback
- Note: JSX was partially stripped in the paste — will reconstruct proper JSX structure from the component logic

### Technical Notes
- The `analyse-damage` edge function will auto-deploy
- No additional database changes needed
- All existing inspections without bbox data will gracefully fall back to legacy positioning

