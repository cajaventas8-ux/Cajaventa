# GUIAS - ACUSE ALAS

Sistema web para gestion de acuses, dashboard operativo, vista previa de impresion y exportacion CSV compatible con Excel.

Este archivo queda como guia del proyecto: instalacion, configuracion, uso, verificacion y datos importantes antes de compartirlo o ponerlo en uso.

## 1. Resumen del proyecto

- Nombre: `ACUSE ALAS`
- Tipo: aplicacion web con frontend estatico y API Node.js.
- Backend: Node.js + Express.
- Base de datos: MySQL.
- Puerto por defecto: `3000`.
- Entrada principal: `index.html`, que redirige al dashboard.
- Dashboard: `views/dashboard-Acuses.html`.
- Gestion de acuses: `views/acuses.html`.
- Vista de impresion: `views/acuse-imprimir.html`.

## 2. Requisitos

- Node.js 18 o superior.
- NPM.
- Acceso a MySQL.
- Acceso de red desde la maquina donde corre la app hasta el servidor MySQL.
- Archivo `.env` local creado a partir de `.env.example`.

## 3. Instalacion

Desde la carpeta del proyecto:

```powershell
npm install
```

## 4. Configuracion

Crear un archivo `.env` local usando `.env.example` como base.

Ejemplo:

```env
PORT=3000
# Dejar vacio si el frontend se sirve desde este mismo servidor.
# Completar solo si vas a consumir la API desde otros origenes, separados por coma.
CORS_ORIGINS=
FRAME_ANCESTORS=self

MYSQL_HOST=172.17.10.101
MYSQL_PORT=3306
MYSQL_USER=logistica
MYSQL_PASSWORD=colocar_password_localmente
MYSQL_CONNECTION_LIMIT=10

MYSQL_ACUSE_DATABASE=BD_ALAS_ACUSE
MYSQL_SAP_DATABASE=BD_ALAS_SAP

ACUSE_DEFAULT_USER=Operador General
```

Importante: el archivo `.env` real no se debe compartir si contiene credenciales reales.

Nota sobre `CORS_ORIGINS`:

- Si los usuarios abren la app desde este mismo servidor, por ejemplo `http://IP-DE-LA-MAQUINA:3000`, puede quedar vacio.
- Solo hace falta completarlo cuando el frontend o integraciones consumen la API desde otro origen distinto.
- Si se usa, separar origenes por coma. Ejemplo: `http://192.168.1.20:3000,https://intranet.alas.com.py`

## 5. Como iniciar

```powershell
npm start
```

Tambien se puede usar:

```powershell
.\serve.ps1
```

## 6. URLs principales

Con el servidor levantado:

- App principal: `http://localhost:3000`
- Dashboard resumen: `http://localhost:3000/views/dashboard-Acuses.html`
- Gestion de acuses: `http://localhost:3000/views/acuses.html`
- Vista de impresion: `http://localhost:3000/views/acuse-imprimir.html?id=ID_DEL_ACUSE`
- Salud del sistema: `http://localhost:3000/api/health`

Si otra maquina de la red necesita probarlo, se debe usar la IP de la maquina que tiene el servidor levantado:

```text
http://IP-DE-LA-MAQUINA:3000
```

Tambien se debe permitir el puerto `3000` en firewall si corresponde.

## 7. Comandos utiles

Revisar sintaxis de los JS propios:

```powershell
npm run check
```

Ejecutar tests automaticos:

```powershell
npm test
```

Levantar app:

```powershell
npm start
```

Instalar dependencias:

```powershell
npm install
```

## 8. Que compartir para pruebas

Si se va a pasar el proyecto a otra persona o a Informatica, compartir:

- Carpeta completa del proyecto.
- `README.md`.
- `.env.example`.
- `package.json`.
- `package-lock.json`.
- Carpetas `server`, `js`, `css`, `views`, `assets` y `vendor`.

No compartir:

- `.env` con credenciales reales.
- `node_modules`, porque se vuelve a generar con `npm install`.
- Archivos `.log`.
- Archivos `.bak`.
- Capturas o documentos con passwords visibles.

## 9. Datos que deben tener en cuenta

- El sistema necesita conexion a las bases `BD_ALAS_ACUSE` y `BD_ALAS_SAP`.
- El usuario MySQL debe tener permisos necesarios de lectura y escritura.
- La ruta `/api/health` sirve para confirmar si la conexion y tablas principales estan bien.
- La exportacion Excel se genera como CSV compatible con Excel.
- La vista de impresion usa el logo local de `assets/img/alas_logo.png`.
- El QR de impresion apunta a `https://alas.com.py/`.
- La app publica solo las carpetas necesarias para el frontend: `assets`, `css`, `js`, `vendor`, `views` e `index.html`.
- Archivos internos como `server/`, `tests/`, `.env`, `README.md`, `package.json` y temporales no deben quedar expuestos por HTTP.

## 10. Checklist antes de dar de alta

Ejecutar:

```powershell
npm run check
```

Luego ejecutar:

```powershell
npm test
```

Luego levantar:

```powershell
npm start
```

Verificar:

- Los tests automáticos pasan.
- `/api/health` responde `ok: true`.
- Abre el dashboard.
- Abre gestion de acuses.
- Se puede crear un acuse de prueba.
- Se puede editar un acuse de prueba.
- Se puede cambiar estado.
- Se puede abrir vista previa de impresion.
- Se puede imprimir acuse.
- Se puede exportar CSV para Excel.
- Los datos de cliente, repartidor, ciudad, articulos y cantidades salen correctamente.

## 11. Recomendaciones para uso real

- Ejecutar Node como servicio permanente, no solo desde una consola manual.
- Definir una URL fija para los usuarios.
- Usar HTTPS si se publica por dominio.
- Revisar backups de base de datos.
- Definir quien puede administrar o reiniciar el servicio.
- Hacer una prueba completa con usuarios reales antes del alta.
- Mantener `.env` protegido y fuera de cualquier envio publico.
