-- Drop the old check constraint that limits position_number to 1-8
ALTER TABLE public.inspection_photos DROP CONSTRAINT IF EXISTS inspection_photos_position_number_check;

-- Add a new constraint allowing any positive position number
ALTER TABLE public.inspection_photos ADD CONSTRAINT inspection_photos_position_number_check CHECK (position_number >= 1);