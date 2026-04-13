
ALTER TABLE damage_items
  ADD COLUMN IF NOT EXISTS bbox_ymin smallint,
  ADD COLUMN IF NOT EXISTS bbox_xmin smallint,
  ADD COLUMN IF NOT EXISTS bbox_ymax smallint,
  ADD COLUMN IF NOT EXISTS bbox_xmax smallint;

ALTER TABLE damage_items
  ADD CONSTRAINT bbox_ymin_range CHECK (bbox_ymin IS NULL OR (bbox_ymin >= 0 AND bbox_ymin <= 1000)),
  ADD CONSTRAINT bbox_xmin_range CHECK (bbox_xmin IS NULL OR (bbox_xmin >= 0 AND bbox_xmin <= 1000)),
  ADD CONSTRAINT bbox_ymax_range CHECK (bbox_ymax IS NULL OR (bbox_ymax >= 0 AND bbox_ymax <= 1000)),
  ADD CONSTRAINT bbox_xmax_range CHECK (bbox_xmax IS NULL OR (bbox_xmax >= 0 AND bbox_xmax <= 1000));

ALTER TABLE damage_items
  ADD CONSTRAINT bbox_y_order CHECK (bbox_ymin IS NULL OR bbox_ymax IS NULL OR bbox_ymax >= bbox_ymin),
  ADD CONSTRAINT bbox_x_order CHECK (bbox_xmin IS NULL OR bbox_xmax IS NULL OR bbox_xmax >= bbox_xmin);

UPDATE damage_items
SET
  bbox_xmin = GREATEST(0, LEAST(1000, (damage_x_percent * 10)::int - 30)),
  bbox_ymin = GREATEST(0, LEAST(1000, (damage_y_percent * 10)::int - 30)),
  bbox_xmax = GREATEST(0, LEAST(1000, (damage_x_percent * 10)::int + 30)),
  bbox_ymax = GREATEST(0, LEAST(1000, (damage_y_percent * 10)::int + 30))
WHERE
  damage_x_percent IS NOT NULL
  AND damage_y_percent IS NOT NULL
  AND bbox_xmin IS NULL;

COMMENT ON COLUMN damage_items.bbox_ymin IS 'Top edge of bounding box (0-1000 scale, 0=top of image)';
COMMENT ON COLUMN damage_items.bbox_xmin IS 'Left edge of bounding box (0-1000 scale, 0=left of image)';
COMMENT ON COLUMN damage_items.bbox_ymax IS 'Bottom edge of bounding box (0-1000 scale, 1000=bottom of image)';
COMMENT ON COLUMN damage_items.bbox_xmax IS 'Right edge of bounding box (0-1000 scale, 1000=right of image)';
