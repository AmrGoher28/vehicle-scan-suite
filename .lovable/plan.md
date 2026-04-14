
What I found

- This is not the wheel stage being removed from the capture UI. The 18-shot flow is still present in `InspectionCaptureFlow`.
- The reason only 8 images appear in the “Inspection Photos” modal is that the database table for inspection photos still only allows `position_number` values `1–8`.
- The current save flow tries to insert shots `1–18`. Shots `1–8` save, shot `9` fails, and the loop stops there. That matches your screenshot exactly: only the 8 overview photos are stored and shown.
- The AI analysis function is not the root cause here; it only processes the photo rows that were successfully saved.

Implementation plan

1. Fix the database constraint
- Create a migration that removes the old `1–8` check on inspection photo positions.
- Replace it with a constraint that supports the new guided flow, ideally `position_number >= 1` so this does not break again if the shot count changes later.
- Keep the existing unique `(inspection_id, position_number)` rule and current access policies.

2. Harden the save flow
- Update `saveInspection()` so failures are reported clearly instead of looking like later stages “disappeared”.
- Surface which shot failed if upload or row creation breaks.
- Avoid leaving silent partial inspections, and clean up uploaded files when a row insert fails.

3. Align the UI with the real flow
- Update stale copy that still says “8 positions around the vehicle”.
- Audit remaining 8-position assumptions in photo/report helpers so detail and wheel shots display correctly everywhere once stored.

4. Verify end to end
- Run a fresh inspection and confirm all 18 shots save.
- Confirm the modal shows overview, detail, and wheel photos.
- Confirm analysis and the report page receive the full saved set.

Technical details

- Existing access rules on inspections and inspection photos are already fine; they are not the blocker.
- The exact blocker is the old `inspection_photos.position_number` check from the original migration.
- Previously broken inspections will remain partial; new inspections after the fix should store all shots correctly unless we also add a separate recovery step for old records.
