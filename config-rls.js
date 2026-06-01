const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bihtbhulcqvlwadatxbk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  console.error('Ejemplo PowerShell: $env:SUPABASE_SERVICE_ROLE_KEY="tu_clave"; node config-rls.js');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const sql = `
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
`;

async function run() {
  // Try direct execution via RPC
  const { error } = await supabase.rpc('exec_sql', { sql });
  if (error) {
    console.log('RPC not available:', error.message);
    console.log('Run this SQL manually in Supabase SQL Editor:\n');
    console.log(sql);
    return;
  }
  console.log('RLS configured successfully');

  // Test anon access now
  const { data, count } = await supabase.from('pedidos').select('*', { count: 'exact' });
  console.log('Anon sees:', count, 'pedidos');
}

run();
