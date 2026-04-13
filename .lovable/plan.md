

## Plan: Add AR Overlays to Inspection Capture Flow

### What's Missing
The current camera view during video walkaround and manual capture has minimal UI — just a coverage map and countdown text. It needs AR-style overlays on the live camera feed to guide the inspector.

### What We'll Add

**1. Framing Guide Brackets**
Corner bracket overlays on the camera feed showing where to position the vehicle in frame. Animated brackets that pulse gently to draw attention. Different bracket positions per zone (e.g., front zone = center frame, side zones = landscape frame).

**2. Distance Indicator**
A real-time text indicator showing "Get closer", "Perfect distance", or "Step back" based on a simulated distance heuristic (since we can't measure actual distance, we'll use the video frame brightness/size analysis or simply guide based on zone timing).

**3. Zone Label Overlay**
Large semi-transparent zone label overlaid on the camera feed (e.g., "FRONT LEFT" with an arrow showing walk direction to the next zone).

**4. Walk Direction Arrow**
An animated arrow showing which direction to walk next, rotating based on the current zone in the 360° walkaround sequence.

**5. Scanning Line Animation**
A horizontal scanning line that sweeps across the camera feed while recording, giving the visual impression of an active scan.

**6. Manual Mode AR Guide**
For manual photo mode: show a semi-transparent vehicle silhouette outline matching the current position (front view, side view, rear view, corner view) so the inspector knows how to frame the shot.

### Technical Approach
- All overlays are CSS/SVG elements absolutely positioned over the `<video>` element
- Animations use CSS keyframes and Tailwind classes
- No external AR libraries needed — this is purely visual guidance overlaid on the camera feed
- Zone-specific framing guides use predefined SVG paths for each of the 8 positions

### Files Changed
- `src/components/InspectionCaptureFlow.tsx` — Add all AR overlay elements to both video and manual capture views

