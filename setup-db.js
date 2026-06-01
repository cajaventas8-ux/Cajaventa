/**
 * SETUP DATABASE - Crea las tablas en Supabase automáticamente
 * USO: node setup-db.js
 *
 * Requiere: npm install @supabase/supabase-js
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bihtbhulcqvlwadatxbk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  console.error('Ejemplo PowerShell: $env:SUPABASE_SERVICE_ROLE_KEY="tu_clave"; node setup-db.js');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function runSQL(filePath) {
  const sql = fs.readFileSync(path.resolve(__dirname, filePath), 'utf8');
  const { error } = await supabase.rpc('exec_sql', { sql });
  if (error) {
    // Si exec_sql no existe, ejecutar statement por statement via REST
    console.log('Intentando método alternativo...');
    const statements = sql.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      const { error: e } = await supabase.from('_exec_sql').select('*').eq('query', stmt).maybeSingle();
      if (e && e.code !== 'PGRST116') {
        console.log('Ejecutando:', stmt.substring(0, 80) + '...');
      }
    }
    console.log('\nNo se pudo ejecutar automáticamente.');
    console.log('Abrí el SQL Editor en https://supabase.com/dashboard/project/bihtbhulcqvwlwadatxbk/sql/new');
    console.log('Y pegá el contenido de sql/crear-tablas.sql');
    return false;
  }
  console.log('Tablas creadas correctamente.');
  return true;
}

runSQL('sql/crear-tablas.sql').then(ok => {
  if (!ok) process.exit(1);
}).catch(err => {
  console.error('Error:', err.message);
  console.log('\nAbrí el SQL Editor en https://supabase.com/dashboard/project/bihtbhulcqvwlwadatxbk/sql/new');
  console.log('Y pegá el contenido de sql/crear-tablas.sql');
  process.exit(1);
});
