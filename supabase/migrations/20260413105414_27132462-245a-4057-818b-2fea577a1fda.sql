
CREATE TABLE public.damage_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inspection_id UUID NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  photo_position INTEGER,
  damage_type TEXT NOT NULL,
  location_on_car TEXT NOT NULL,
  size_estimate TEXT,
  severity TEXT NOT NULL DEFAULT 'minor',
  confidence_score INTEGER,
  repair_cost_estimate_aed NUMERIC,
  description TEXT,
  detected_by_model TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.damage_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view damage items for their vehicles"
ON public.damage_items FOR SELECT
USING (EXISTS (
  SELECT 1 FROM inspections i JOIN vehicles v ON v.id = i.vehicle_id
  WHERE i.id = damage_items.inspection_id AND v.user_id = auth.uid()
));

CREATE POLICY "Users can create damage items for their vehicles"
ON public.damage_items FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM inspections i JOIN vehicles v ON v.id = i.vehicle_id
  WHERE i.id = damage_items.inspection_id AND v.user_id = auth.uid()
));

CREATE POLICY "Users can delete damage items for their vehicles"
ON public.damage_items FOR DELETE
USING (EXISTS (
  SELECT 1 FROM inspections i JOIN vehicles v ON v.id = i.vehicle_id
  WHERE i.id = damage_items.inspection_id AND v.user_id = auth.uid()
));
