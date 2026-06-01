# Caja Ventas

Aplicacion web para importar pedidos desde Excel, consultar el dashboard operativo y administrar estados de pedidos usando Supabase.

## Arquitectura actual

- Frontend estatico: `index.html`, `views/`, `js/`, `css/`, `assets/` y `vendor/`.
- Servidor local: `server.js` solo sirve archivos publicos.
- Datos: Supabase REST desde `js/supabase.js`.
- Utilidades Node: `setup-db.js`, `importar-excel.js` y `config-rls.js`.

No hay backend Express ni MySQL en esta version del proyecto.

## Requisitos

- Node.js 18 o superior.
- NPM.
- Acceso al proyecto Supabase.
- Para scripts administrativos: `SUPABASE_SERVICE_ROLE_KEY` configurada en el entorno.

## Instalacion

```powershell
npm install
```

## Ejecutar local

```powershell
npm start
```

URLs principales:

- App: `http://localhost:3000`
- Dashboard: `http://localhost:3000/views/dashboard-Cajaventa.html`
- Pedidos: `http://localhost:3000/views/pedidos.html`

## Verificacion

```powershell
npm run check
npm test
```

`npm test` ejecuta la misma verificacion de sintaxis por ahora.

## Variables de entorno para administracion

Crear un `.env` local o definir variables en PowerShell. El proyecto no carga `.env` automaticamente; para una ejecucion puntual:

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY="tu_clave_service_role"
$env:SUPABASE_URL="https://bihtbhulcqvlwadatxbk.supabase.co"
```

Para importar un Excel especifico:

```powershell
$env:EXCEL_FILE="C:/ruta/pedidoscaja.xlsm"
node importar-excel.js
```

## Seguridad

- Nunca publicar la clave `service_role`.
- La clave anonima de Supabase puede estar en el frontend, pero solo debe tener permisos controlados por RLS.
- Si una clave `service_role` ya estuvo en archivos compartidos o publicados, rotarla desde Supabase.
- `server.js` bloquea archivos internos como `.env`, `setup-db.js`, `importar-excel.js`, `config-rls.js` y `sql/`.
- `.vercelignore` excluye archivos administrativos del despliegue estatico.

Nota importante: la app actual escribe en Supabase directamente desde el navegador. Para produccion con datos sensibles, lo recomendable es mover las escrituras a un backend o usar autenticacion real con politicas RLS restrictivas.

## Archivos importantes

- `js/supabase.js`: capa de datos y adaptador para las rutas `/api/...` usadas por el frontend.
- `js/pedidos-data.js`: importacion y cache de pedidos.
- `js/pedidos-ui.js`: integracion de pedidos con el dashboard.
- `sql/crear-tablas.sql`: estructura de tablas y politicas RLS permisivas para la app actual.
- `server.js`: servidor local estatico con lista blanca de carpetas publicas.

## Antes de compartir o desplegar

- No incluir `.env`.
- No incluir `node_modules`.
- Verificar `npm run check`.
- Confirmar que la clave `service_role` no aparece en ningun archivo.
- Rotar la clave antigua si alguna vez estuvo expuesta.
