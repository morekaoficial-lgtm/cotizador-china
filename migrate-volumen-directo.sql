-- Migración: añadir soporte para volumen directo (m³)
-- Ejecutar en la base de datos existente:
--   sudo -u postgres psql -d cotizador_china -f migrate-volumen-directo.sql

ALTER TABLE productos
  ALTER COLUMN largo_cm SET DEFAULT 0,
  ALTER COLUMN ancho_cm SET DEFAULT 0,
  ALTER COLUMN alto_cm  SET DEFAULT 0;

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS volumen_directo BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS volumen_m3 NUMERIC(12,4) DEFAULT NULL;
