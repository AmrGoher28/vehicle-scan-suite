
-- Add inspection_type to inspections
ALTER TABLE public.inspections
ADD COLUMN inspection_type TEXT NOT NULL DEFAULT 'check-out';

-- Create inspection_photos table
CREATE TABLE public.inspection_photos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inspection_id UUID NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  position_number INTEGER NOT NULL CHECK (position_number BETWEEN 1 AND 8),
  position_name TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(inspection_id, position_number)
);

ALTER TABLE public.inspection_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view photos for their vehicle inspections" ON public.inspection_photos
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.inspections i
    JOIN public.vehicles v ON v.id = i.vehicle_id
    WHERE i.id = inspection_photos.inspection_id AND v.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create photos for their vehicle inspections" ON public.inspection_photos
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.inspections i
    JOIN public.vehicles v ON v.id = i.vehicle_id
    WHERE i.id = inspection_photos.inspection_id AND v.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete photos for their vehicle inspections" ON public.inspection_photos
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.inspections i
    JOIN public.vehicles v ON v.id = i.vehicle_id
    WHERE i.id = inspection_photos.inspection_id AND v.user_id = auth.uid()
  )
);

-- Create storage bucket for inspection photos
INSERT INTO storage.buckets (id, name, public) VALUES ('inspection-photos', 'inspection-photos', true);

CREATE POLICY "Anyone can view inspection photos" ON storage.objects FOR SELECT USING (bucket_id = 'inspection-photos');
CREATE POLICY "Authenticated users can upload inspection photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'inspection-photos' AND auth.role() = 'authenticated');
