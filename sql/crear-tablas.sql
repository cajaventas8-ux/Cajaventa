-- =============================================================
-- CAJA VENTAS - SUPABASE TABLES (fresh setup)
-- =============================================================

DROP TABLE IF EXISTS pedido_items CASCADE;
DROP TABLE IF EXISTS pedidos_historial CASCADE;
DROP TABLE IF EXISTS auditoria CASCADE;
DROP TABLE IF EXISTS pedidos CASCADE;
DROP TABLE IF EXISTS repartidores CASCADE;
DROP TABLE IF EXISTS clientes CASCADE;
DROP TABLE IF EXISTS articulos CASCADE;

-- 1. PEDIDOS
CREATE TABLE pedidos (
  entrega TEXT PRIMARY KEY,
  pedido TEXT,
  solicitud TEXT,
  cliente TEXT,
  vendedor TEXT,
  fecha DATE,
  usuario_empaque TEXT,
  almacen TEXT,
  observacion TEXT,
  monto NUMERIC DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','contabilizado','facturado','anulado')),
  fecha_importacion TIMESTAMPTZ DEFAULT NOW(),
  fecha_actualizacion TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ITEMS
CREATE TABLE pedido_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_entrega TEXT NOT NULL REFERENCES pedidos(entrega) ON DELETE CASCADE,
  material TEXT,
  denominacion TEXT,
  cantidad NUMERIC DEFAULT 0,
  unidad TEXT,
  cont_entr NUMERIC DEFAULT 0,
  cont_art NUMERIC DEFAULT 0
);

-- 3. HISTORIAL
CREATE TABLE pedidos_historial (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entrega TEXT NOT NULL REFERENCES pedidos(entrega) ON DELETE CASCADE,
  estado TEXT NOT NULL,
  usuario TEXT DEFAULT 'sistema',
  observacion TEXT,
  fecha TIMESTAMPTZ DEFAULT NOW()
);

-- 4. REPARTIDORES
CREATE TABLE repartidores (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  codigo TEXT,
  estado TEXT DEFAULT 'Activo' CHECK (estado IN ('Activo','Inactivo'))
);

-- 5. CLIENTES
CREATE TABLE clientes (
  cod_cliente TEXT PRIMARY KEY,
  nom_cliente TEXT,
  ruc_cliente TEXT,
  direc_cliente TEXT,
  telefono_cliente TEXT,
  ciudad_cliente TEXT,
  zona_cliente TEXT
);

-- 6. ARTICULOS
CREATE TABLE articulos (
  material_sap TEXT PRIMARY KEY,
  descr_sap TEXT,
  um_sap TEXT
);

-- 7. AUDITORIA
CREATE TABLE auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accion TEXT NOT NULL,
  usuario TEXT DEFAULT 'sistema',
  cliente TEXT,
  entrega TEXT,
  detalle TEXT,
  fecha TIMESTAMPTZ DEFAULT NOW()
);

-- ÍNDICES
CREATE INDEX idx_pedidos_estado ON pedidos(estado);
CREATE INDEX idx_pedidos_fecha ON pedidos(fecha);
CREATE INDEX idx_pedidos_cliente ON pedidos(cliente);
CREATE INDEX idx_pedido_items_entrega ON pedido_items(pedido_entrega);
CREATE INDEX idx_pedidos_historial_entrega ON pedidos_historial(entrega);
CREATE INDEX idx_auditoria_fecha ON auditoria(fecha);

-- RLS habilitado. Estas politicas mantienen funcional el frontend directo
-- con clave anonima; para produccion real conviene migrar escrituras a backend.
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE repartidores ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE articulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_all ON pedidos;
DROP POLICY IF EXISTS anon_all ON pedido_items;
DROP POLICY IF EXISTS anon_all ON pedidos_historial;
DROP POLICY IF EXISTS anon_all ON repartidores;
DROP POLICY IF EXISTS anon_all ON clientes;
DROP POLICY IF EXISTS anon_all ON articulos;
DROP POLICY IF EXISTS anon_all ON auditoria;

CREATE POLICY anon_all ON pedidos FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON pedido_items FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON pedidos_historial FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON repartidores FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON clientes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON articulos FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON auditoria FOR ALL TO anon USING (true) WITH CHECK (true);

-- TRIGGER fecha_actualizacion
CREATE OR REPLACE FUNCTION update_fecha_actualizacion()
RETURNS TRIGGER AS $$
BEGIN
  NEW.fecha_actualizacion = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pedidos_actualizacion ON pedidos;
CREATE TRIGGER trg_pedidos_actualizacion
  BEFORE UPDATE ON pedidos
  FOR EACH ROW
  EXECUTE FUNCTION update_fecha_actualizacion();
