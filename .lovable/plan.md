

## Plan: Accurate Damage Coordinates + Dual Image View + Circle Style

### Overview
Three coordinated changes: (1) AI returns precise damage coordinates, stored in new DB columns, (2) report cards show a dual photo view with full image + zoomed crop, (3) red circle annotations use AI coordinates and a refined pulsing style.

To answer your question: the red circles are drawn by **CSS/HTML in the React frontend** (`InspectionReport.tsx`), not by the AI model. The AI only analyzes the photo and returns data — the circles are overlaid in the browser using absolute positioning.

---

### 1. Database Migration
Add two nullable numeric columns to `damage_items`:
- `damage_x_percent NUMERIC` (0-100, distance from left edge)
- `damage_y_percent NUMERIC` (0-100, distance from top edge)

### 2. Edge Function (`analyse-damage/index.ts`)
- **First pass prompt**: Append to `FIRST_PASS_SYSTEM`: *"For each damage item, also return two additional fields: damage_x_percent (a number 0-100 representing how far from the left edge of the photo the damage is) and damage_y_percent (a number 0-100 representing how far from the top edge of the photo the damage is). Study the image carefully and pinpoint exactly where the damage appears in the photo."*
- **Second pass prompt**: Add `damage_x_percent` and `damage_y_percent` to the list of returned fields.
- **Insert rows**: Map `damage_x_percent` and `damage_y_percent` from AI response into the DB insert.

### 3. Report UI (`InspectionReport.tsx`)

**DamageItem type** — add `damage_x_percent: number | null` and `damage_y_percent: number | null`.

**DamageCard redesign:**
- Two images side by side inside each card:
  - **Left (250×180px)**: Full inspection photo with a 40px red circle positioned at `damage_x_percent / damage_y_percent` (falling back to text-based `locationToPhotoXY` if null). Circle has 2px solid red border, pulsing red glow via CSS `@keyframes`, and a small number label inside.
  - **Right (150×180px)**: Zoomed crop using `background-image` of the same photo, `background-size: 300%`, `background-position` calculated from the damage coordinates to center the damage. Labeled "DETAIL" at the top. Subtle border.
  - A thin connecting bracket/line drawn via SVG between the circle on the left image and the zoom panel.

**DamageMarker** — also updated to use AI coordinates when available, with the smaller 40px pulsing style.

**CSS** — add `@keyframes pulseGlow` animation to `src/index.css` for the red circle glow effect.

### 4. Deploy
- Run DB migration
- Redeploy `analyse-damage` edge function
- Existing scans without coordinates will gracefully fall back to text-based positioning

---

### Technical Details

**Zoom background-position formula:**
```
background-position: ${100 - xPct}% ${100 - yPct}%
// adjusted so damage is centered in the 150px crop
```

**Pulsing glow keyframes:**
```css
@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 0 6px 1px rgba(239,68,68,0.4); }
  50% { box-shadow: 0 0 14px 4px rgba(239,68,68,0.7); }
}
```

**Files modified:**
- `supabase/functions/analyse-damage/index.ts` — prompts + insert mapping
- `src/pages/InspectionReport.tsx` — DamageCard dual view, DamageMarker, types
- `src/index.css` — pulse animation
- New migration for `damage_x_percent` / `damage_y_percent` columns

