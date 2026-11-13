-- =====================================================================
-- Cotizador de Importaciones China → México — Esquema PostgreSQL
-- Ejecutar:  psql $DATABASE_URL -f schema.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO config (key, value) VALUES ('tarifa_m3', '800')
ON CONFLICT (key) DO NOTHING;
INSERT INTO config (key, value) VALUES ('modo_cobro', 'fraccion')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS productos (
  id               UUID PRIMARY KEY,
  concepto         TEXT NOT NULL,
  largo_cm         NUMERIC(10,2) NOT NULL DEFAULT 0,
  ancho_cm         NUMERIC(10,2) NOT NULL DEFAULT 0,
  alto_cm          NUMERIC(10,2) NOT NULL DEFAULT 0,
  cajas            INTEGER NOT NULL,
  piezas_por_caja  INTEGER NOT NULL,
  precio_exw       NUMERIC(12,4) NOT NULL,
  precio_exw_moneda VARCHAR(3) NOT NULL DEFAULT 'USD',
  peso_kg          NUMERIC(10,2) DEFAULT 0,
  costo_yiwu       NUMERIC(12,4) NOT NULL DEFAULT 0,
  costo_yiwu_moneda VARCHAR(3) NOT NULL DEFAULT 'USD',
  tc_ref           NUMERIC(10,4) NOT NULL DEFAULT 7.2,
  tc_usd_mxn       NUMERIC(10,4) NOT NULL DEFAULT 18.2,
  incluir_gestor   BOOLEAN NOT NULL DEFAULT FALSE,
  volumen_directo  BOOLEAN NOT NULL DEFAULT FALSE,
  volumen_m3       NUMERIC(12,4) DEFAULT NULL,
  estado           VARCHAR(20) NOT NULL DEFAULT 'borrador_inicial'
                   CHECK (estado IN ('borrador_inicial','borrador_completo','comprado','cerrado')),
  proveedor        JSONB NOT NULL DEFAULT '{}',
  anticipos        JSONB NOT NULL DEFAULT '[]',
  consolidado_id   UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_productos_estado ON productos(estado);

CREATE TABLE IF NOT EXISTS proveedores (
  id               UUID PRIMARY KEY,
  nombre           TEXT NOT NULL,
  ciudad           TEXT,
  telefono         TEXT,
  contacto         TEXT,
  trade_assurance  BOOLEAN DEFAULT FALSE,
  verified         BOOLEAN DEFAULT FALSE,
  anios_experiencia INTEGER,
  calificacion     NUMERIC(3,1),
  cert_ce          BOOLEAN DEFAULT FALSE,
  cert_cpc         BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proveedores_nombre ON proveedores(nombre);

CREATE TABLE IF NOT EXISTS consolidados (
  id         UUID PRIMARY KEY,
  nombre     TEXT NOT NULL,
  tarifa_m3  NUMERIC(12,2) NOT NULL,
  modo_cobro VARCHAR(20) NOT NULL DEFAULT 'fraccion',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consolidado_items (
  id                 UUID PRIMARY KEY,
  consolidado_id     UUID NOT NULL REFERENCES consolidados(id) ON DELETE CASCADE,
  producto_id        UUID,
  concepto           TEXT NOT NULL,
  cajas              INTEGER NOT NULL,
  piezas_por_caja    INTEGER NOT NULL,
  largo_cm           NUMERIC(10,2) NOT NULL,
  ancho_cm           NUMERIC(10,2) NOT NULL,
  alto_cm            NUMERIC(10,2) NOT NULL,
  precio_exw         NUMERIC(12,4) NOT NULL,
  precio_exw_moneda  VARCHAR(3) NOT NULL DEFAULT 'USD',
  costo_yiwu         NUMERIC(12,4) NOT NULL DEFAULT 0,
  costo_yiwu_moneda  VARCHAR(3) NOT NULL DEFAULT 'USD',
  yiwu_unit          NUMERIC(12,4) NOT NULL DEFAULT 0,
  import_unit        NUMERIC(12,4) NOT NULL DEFAULT 0,
  costo_import_total NUMERIC(12,4) NOT NULL DEFAULT 0,
  costo_final_unit   NUMERIC(12,4) NOT NULL DEFAULT 0,
  volumen            NUMERIC(12,4) NOT NULL DEFAULT 0,
  volumen_cobrado    NUMERIC(12,4) NOT NULL DEFAULT 0
);

-- =====================================================================
-- VARIANTE MySQL (si prefieres MySQL/MariaDB en DigitalOcean):
--
-- CREATE TABLE config (cfg_key VARCHAR(50) PRIMARY KEY, cfg_value VARCHAR(50) NOT NULL);
-- INSERT IGNORE INTO config VALUES ('tarifa_m3', '800');
-- INSERT IGNORE INTO config VALUES ('modo_cobro', 'fraccion');
--
-- CREATE TABLE productos (
--   id CHAR(36) PRIMARY KEY, concepto VARCHAR(255) NOT NULL,
--   largo_cm DECIMAL(10,2) NOT NULL, ancho_cm DECIMAL(10,2) NOT NULL, alto_cm DECIMAL(10,2) NOT NULL,
--   cajas INT NOT NULL, piezas_por_caja INT NOT NULL, precio_exw DECIMAL(12,4) NOT NULL,
--   precio_exw_moneda VARCHAR(3) DEFAULT 'USD', peso_kg DECIMAL(10,2) DEFAULT 0,
--   costo_yiwu DECIMAL(12,4) NOT NULL DEFAULT 0, costo_yiwu_moneda VARCHAR(3) DEFAULT 'USD',
--   tc_ref DECIMAL(10,4) DEFAULT 7.2,
--   estado ENUM('borrador_inicial','borrador_completo','comprado','cerrado') NOT NULL DEFAULT 'borrador_inicial',
--   proveedor JSON, anticipos JSON, consolidado_id CHAR(36) NULL,
--   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
--   INDEX idx_estado (estado));
--
-- CREATE TABLE consolidados (
--   id CHAR(36) PRIMARY KEY, nombre VARCHAR(255) NOT NULL,
--   tarifa_m3 DECIMAL(12,2) NOT NULL, modo_cobro VARCHAR(20) DEFAULT 'fraccion',
--   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
--
-- CREATE TABLE consolidado_items (
--   id CHAR(36) PRIMARY KEY, consolidado_id CHAR(36) NOT NULL,
--   producto_id CHAR(36) NULL, concepto VARCHAR(255) NOT NULL,
--   cajas INT NOT NULL, piezas_por_caja INT NOT NULL,
--   largo_cm DECIMAL(10,2) NOT NULL, ancho_cm DECIMAL(10,2) NOT NULL, alto_cm DECIMAL(10,2) NOT NULL,
--   precio_exw DECIMAL(12,4) NOT NULL, precio_exw_moneda VARCHAR(3) DEFAULT 'USD',
--   costo_yiwu DECIMAL(12,4) NOT NULL DEFAULT 0, costo_yiwu_moneda VARCHAR(3) DEFAULT 'USD',
--   yiwu_unit DECIMAL(12,4) DEFAULT 0, import_unit DECIMAL(12,4) DEFAULT 0,
--   costo_import_total DECIMAL(12,4) DEFAULT 0, costo_final_unit DECIMAL(12,4) DEFAULT 0,
--   volumen DECIMAL(12,4) DEFAULT 0, volumen_cobrado DECIMAL(12,4) DEFAULT 0,
--   FOREIGN KEY (consolidado_id) REFERENCES consolidados(id) ON DELETE CASCADE);
-- (En MySQL cambia `require('pg')` por `mysql2` y ajusta las consultas $1→?)
-- =====================================================================
