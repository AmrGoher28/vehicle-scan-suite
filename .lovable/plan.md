

## Plan: Replace InspectionCaptureFlow and analyse-damage edge function

### Step 1: Replace `src/components/InspectionCaptureFlow.tsx`
Replace with the new version featuring:
- Simplified flow states: `intro → position → capture → preview → stage_done → review → saving`
- Full-screen "walk here" position cards with large diagrams before each shot
- Framing brackets on the live camera (corner brackets for overview/detail, circular guide for wheels)
- Faint shot silhouette overlay on camera view
- Skip shot capability with minimum 10 photos required for submission
- Distance hint bar persistent on camera view
- Removed auto-capture/proximity detection — manual tap only
- Added `RotateCw` icon import

### Step 2: Replace `supabase/functions/analyse-damage/index.ts`
Replace with the updated version featuring:
- Reverted to single `FIRST_PASS_SYSTEM` prompt for all photo types (instead of 3 separate prompts)
- Per-photo context hints still vary by category but use the same base system prompt
- Added legacy naming support in `classifyPhoto` (`"manual damage"` → detail)
- Kept all existing infrastructure: `parseBoundingBox`, `normaliseKey`, `preMergeDuplicates`, second pass, batch processing

### Step 3: Deploy the edge function

### Technical Notes
- No database changes needed
- Edge function auto-deploys after update

