
CREATE TABLE public.vehicles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  colour TEXT NOT NULL,
  plate_number TEXT NOT NULL,
  photo_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own vehicles" ON public.vehicles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create vehicles" ON public.vehicles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own vehicles" ON public.vehicles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own vehicles" ON public.vehicles FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE public.inspections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view inspections for their vehicles" ON public.inspections FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.vehicles WHERE vehicles.id = inspections.vehicle_id AND vehicles.user_id = auth.uid())
);
CREATE POLICY "Users can create inspections for their vehicles" ON public.inspections FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.vehicles WHERE vehicles.id = inspections.vehicle_id AND vehicles.user_id = auth.uid())
);
CREATE POLICY "Users can update inspections for their vehicles" ON public.inspections FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.vehicles WHERE vehicles.id = inspections.vehicle_id AND vehicles.user_id = auth.uid())
);
CREATE POLICY "Users can delete inspections for their vehicles" ON public.inspections FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.vehicles WHERE vehicles.id = inspections.vehicle_id AND vehicles.user_id = auth.uid())
);

INSERT INTO storage.buckets (id, name, public) VALUES ('vehicle-photos', 'vehicle-photos', true);

CREATE POLICY "Anyone can view vehicle photos" ON storage.objects FOR SELECT USING (bucket_id = 'vehicle-photos');
CREATE POLICY "Authenticated users can upload vehicle photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'vehicle-photos' AND auth.role() = 'authenticated');
CREATE POLICY "Users can update their vehicle photos" ON storage.objects FOR UPDATE USING (bucket_id = 'vehicle-photos' AND auth.role() = 'authenticated');
CREATE POLICY "Users can delete their vehicle photos" ON storage.objects FOR DELETE USING (bucket_id = 'vehicle-photos' AND auth.role() = 'authenticated');
