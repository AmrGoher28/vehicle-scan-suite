

## Plan: Update InspectionCaptureFlow and analyse-damage edge function

### Step 1: Replace `src/components/InspectionCaptureFlow.tsx`
Replace with the new 18-shot, 3-stage guided capture flow featuring:
- Three stages: Overview (8 shots, 3-4m away), Detail (6 close-ups of panels/sills), Wheels (4 wheel close-ups)
- Real-time proximity detection via frame variance analysis
- Auto-capture after 2s of stable "good" proximity
- SVG shot guides per view angle (front, rear, side, corner, low, wheel)
- Proximity ring with countdown arc
- Top-down position map
- Stage transition screens with tips
- Full review screen before submission
- Live-capture timestamp watermark (anti-fraud)

### Step 2: Replace `supabase/functions/analyse-damage/index.ts`
Replace with the updated edge function featuring:
- Category-specific system prompts: `OVERVIEW_SYSTEM`, `DETAIL_SYSTEM`, `WHEEL_SYSTEM` (tailored to photo distance/subject)
- Photo classification by `position_name` prefix (overview/detail/wheel)
- Improved `normaliseKey()` for cross-photo duplicate merging (strips filler words)
- Detail/wheel photos prioritised first in processing order
- Low-confidence items (< 35%) flagged as `needs_review` instead of auto-confirmed
- Batch size increased to 4
- Realistic AED repair cost ranges in second-pass prompt

### Step 3: Deploy the edge function

### Technical Notes
- No database changes needed — uses existing bbox columns
- The edge function auto-deploys after update

