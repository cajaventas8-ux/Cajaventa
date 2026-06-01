/**
 * Importar Excel a Supabase
 * Uso: node importar-excel.js
 */
const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bihtbhulcqvlwadatxbk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const EXCEL_FILE = process.env.EXCEL_FILE || 'C:/Users/AGOMEZ/Downloads/pedidoscaja.xlsm';

if (!SUPABASE_SERVICE_KEY) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  console.error('Ejemplo PowerShell: $env:SUPABASE_SERVICE_ROLE_KEY="tu_clave"; $env:EXCEL_FILE="C:/ruta/pedidos.xlsm"; node importar-excel.js');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function formatearFecha(val) {
  if (!val && val !== 0) return null;
  // Si es string con formato
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    const m = val.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return m[3] + '-' + m[2] + '-' + m[1];
    return val;
  }
  // Si es número serial de Excel
  if (typeof val === 'number' && val > 40000) {
    const d = new Date((val - 25569) * 86400 * 1000);
    return d.toISOString().split('T')[0];
  }
  return String(val);
}

async function crearTablas() {
  console.log('Creando tablas...');
  const sql = `
CREATE TABLE IF NOT EXISTS pedidos (
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
CREATE TABLE IF NOT EXISTS pedido_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_entrega TEXT NOT NULL REFERENCES pedidos(entrega) ON DELETE CASCADE,
  material TEXT,
  denominacion TEXT,
  cantidad NUMERIC DEFAULT 0,
  unidad TEXT,
  cont_entr NUMERIC DEFAULT 0,
  cont_art NUMERIC DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pedidos_historial (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entrega TEXT NOT NULL REFERENCES pedidos(entrega) ON DELETE CASCADE,
  estado TEXT NOT NULL,
  usuario TEXT DEFAULT 'sistema',
  observacion TEXT,
  fecha TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS repartidores (id SERIAL PRIMARY KEY, nombre TEXT, codigo TEXT, estado TEXT DEFAULT 'Activo');
CREATE TABLE IF NOT EXISTS clientes (cod_cliente TEXT PRIMARY KEY, nom_cliente TEXT, ruc_cliente TEXT, direc_cliente TEXT, telefono_cliente TEXT, ciudad_cliente TEXT, zona_cliente TEXT);
CREATE TABLE IF NOT EXISTS articulos (material_sap TEXT PRIMARY KEY, descr_sap TEXT, um_sap TEXT);
CREATE TABLE IF NOT EXISTS auditoria (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), accion TEXT NOT NULL, usuario TEXT DEFAULT 'sistema', cliente TEXT, entrega TEXT, detalle TEXT, fecha TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha ON pedidos(fecha);
  `.split(';').filter(s => s.trim());

  for (const stmt of sql) {
    const { error } = await supabase.rpc('exec_sql', { sql: stmt + ';' });
    if (error && error.code !== 'PGRST116') {
      // Try direct query via REST
      try {
        await supabase.from('pedidos').select('entrega').limit(1);
        console.log('  Tablas ya existen o conexión OK');
        return true;
      } catch (e) {
        console.log('  Nota: exec_sql RPC no disponible, las tablas deben crearse manualmente');
        return false;
      }
    }
  }
  console.log('  Tablas creadas correctamente');
  return true;
}

async function importar() {
  const filePath = EXCEL_FILE;
  console.log('Leyendo Excel:', filePath);

  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  console.log('Filas leídas:', rows.length);

  // Agrupar por Entrega
  const grupos = {};
  rows.forEach(row => {
    const entrega = String(row['Entrega'] || '').trim();
    if (!entrega) return;
    if (!grupos[entrega]) {
      const puestExped = String(
        row['PuestExped'] || row['Puest.Exped'] || row['Puest. Exped'] ||
        row['Puesto Exped'] || row['Puesto de Expedición'] || row['PstExp'] ||
        row['Puest.Exped.'] || row['Puest Exped'] || ''
      ).trim();
      grupos[entrega] = {
        entrega,
        pedido: String(row['Pedido'] || '').trim(),
        solicitud: String(row['Solic.'] || '').trim(),
        cliente: String(row['Nombre'] || '').trim(),
        vendedor: String(row['Nombre Vend.'] || '').trim(),
        fecha: formatearFecha(row['Fecha Creac']),
        usuarioEmpaque: String(row['Usuario Empaque'] || '').trim(),
        almacen: puestExped === '' ? '' : (puestExped === 'ALDF' ? 'FABRICA' : 'DEPOSITO'),
        items: []
      };
    }
    grupos[entrega].items.push({
      material: String(row['Material'] || '').trim(),
      denominacion: String(row['Denomin.'] || '').trim(),
      cantidad: parseFloat(String(row['Ctd.entr.'] || '0').replace(',', '.')) || 0,
      unidad: String(row['Unidad'] || '').trim(),
      contEntr: parseFloat(String(row['Cont.Entr'] || '0').replace(',', '.')) || 0,
      contArt: parseFloat(String(row['Cont.Art'] || '0').replace(',', '.')) || 0
    });
  });

  const entregas = Object.values(grupos);
  console.log('Entregas únicas:', entregas.length);

  let importados = 0, actualizados = 0;

  for (const g of entregas) {
    // Verificar si existe
    const { data: existing } = await supabase
      .from('pedidos')
      .select('entrega, estado')
      .eq('entrega', g.entrega)
      .maybeSingle();

    const estado = existing ? existing.estado : 'pendiente';

    const { error: pedidoError } = await supabase
      .from('pedidos')
      .upsert({
        entrega: g.entrega,
        pedido: g.pedido,
        solicitud: g.solicitud,
        cliente: g.cliente,
        vendedor: g.vendedor,
        fecha: g.fecha || null,
        usuario_empaque: g.usuarioEmpaque,
        almacen: g.almacen,
        estado: estado
      }, { onConflict: 'entrega' });

    if (pedidoError) {
      console.error('Error insertando pedido', g.entrega, pedidoError);
      continue;
    }

    // Reemplazar items
    await supabase.from('pedido_items').delete().eq('pedido_entrega', g.entrega);
    if (g.items.length > 0) {
      const itemsPayload = g.items.map(it => ({
        pedido_entrega: g.entrega,
        material: it.material,
        denominacion: it.denominacion,
        cantidad: it.cantidad,
        unidad: it.unidad,
        cont_entr: it.contEntr,
        cont_art: it.contArt
      }));
      const { error: itemsError } = await supabase.from('pedido_items').insert(itemsPayload);
      if (itemsError) console.error('Error insertando items', g.entrega, itemsError);
    }

    if (existing) actualizados++;
    else importados++;
  }

  console.log('\n✅ Importación completada:');
  console.log('   Nuevos:', importados);
  console.log('   Actualizados:', actualizados);
  console.log('   Total:', entregas.length);

  // Auditoría
  await supabase.from('auditoria').insert({
    accion: 'importacion_excel',
    usuario: 'sistema',
    detalle: `Importados ${importados} nuevos, ${actualizados} actualizados desde Excel`
  });
}

importar().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
