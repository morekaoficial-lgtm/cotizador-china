# 🇨🇳➡️🇲🇽 Cotizador de Importaciones — China a México

Aplicación web full-stack para cotizar importaciones desde China: cálculo del **costo unitario
puesto en México**, gestión de borradores con proveedores y **consolidados de envío** con
reajuste de tarifa por m³.

- **Frontend estático**: HTML + Tailwind CSS + JS puro → alojable en **IONOS (1&1)**
- **Backend**: Node.js + Express + PostgreSQL → **DigitalOcean**
- **Fallback automático**: si el backend no responde, la app trabaja 100 % en `localStorage`
  y muestra el badge "📴 Modo local".

---

## 📁 Estructura

```
├── index.html      → Frontend (subir a IONOS)
├── styles.css      → Estilos personalizados
├── app.js          → Lógica del cliente + fallback localStorage
├── server.js       → API REST (DigitalOcean)
├── schema.sql      → Esquema PostgreSQL (+ variante MySQL en comentarios)
└── package.json    → Dependencias del backend
```

## 🧮 Fórmulas implementadas

| Cálculo | Fórmula |
|---|---|
| Total de unidades | `cajas × piezas_por_caja` |
| Volumen total (m³) | `(L×A×Al)/1,000,000 × cajas` |
| Costo importación | `volumen × tarifa_m3` |
| Importación / unidad | `costo_importación / total_unidades` |
| Flete Yiwu / unidad | `costo_yiwu / total_unidades` |
| **Costo final unitario MX** | `EXW + importación/u + Yiwu/u` |
| **Costo total embarque** | `EXW×unidades + Yiwu + volumen×tarifa` |

## 🔧 1. Backend en DigitalOcean

### Opción A — Droplet (Ubuntu)

```bash
# En el servidor
sudo apt update && sudo apt install -y nodejs npm postgresql
sudo -u postgres psql -c "CREATE USER cotizador WITH PASSWORD 'TU_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE cotizador OWNER cotizador;"

git clone <tu-repo> && cd cotizador
npm install
# Crear .env:
echo "DATABASE_URL=postgres://cotizador:TU_PASSWORD@localhost:5432/cotizador
PORT=4000" > .env

psql $DATABASE_URL -f schema.sql
node server.js          # o usar PM2: pm2 start server.js --name cotizador
```

Abrir el firewall y (recomendado) poner Nginx + HTTPS con Let's Encrypt:

```nginx
location /api/ {
  proxy_pass http://localhost:4000;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}
```

### Opción B — DigitalOcean App Platform + Managed PostgreSQL

1. Crea un **Managed Database PostgreSQL** y copia la cadena de conexión.
2. En App Platform: nuevo app desde tu repo, comando de build `npm install`,
   comando de ejecución `node server.js`, variable de entorno `DATABASE_URL`.
3. Ejecuta `schema.sql` una vez desde la consola de la DB.

## 🌐 2. Frontend en IONOS (1&1)

1. Sube `index.html`, `styles.css` y `app.js` por FTP/SFTP o el gestor de archivos
   al directorio `public_html` (o una subcarpeta).
2. Abre la app → pestaña **⚙️ Configuración** → en "URL del Backend API" pon
   `https://api.tudominio.com` → Guardar. El badge pasará a 🟢.
3. **Sin backend** también funciona: simplemente no configures la URL (modo local).

> Si subes frontend y backend al mismo dominio con Nginx (sección anterior),
> deja la URL del backend en vacío ("mismo origen").

## 🔌 API REST (resumen)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del servicio y DB |
| GET/PUT | `/api/config` | Leer / guardar tarifa m³ |
| GET/POST | `/api/productos` | Listar / crear cotización |
| PUT/DELETE | `/api/productos/:id` | Actualizar / eliminar |
| GET/POST | `/api/consolidados` | Listar / crear consolidado |
| PUT | `/api/consolidados/:id/tarifa` | Reajustar tarifa y recalcular |

## ✅ Checklist de producción

- [ ] Cambiar el `cors()` abierto por dominios permitidos en `server.js`
- [ ] HTTPS en backend (Let's Encrypt / cert de App Platform)
- [ ] Backup automático de la base de datos (snapshots DO)
- [ ] PM2 o systemd para mantener el proceso vivo: `pm2 start server.js && pm2 save`
