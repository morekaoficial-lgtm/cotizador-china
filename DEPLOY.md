# Guia de Despliegue en DigitalOcean

## Cotizador de Importaciones China -> Mexico

---

## Opcion A: Droplet Ubuntu (Recomendada - mas control)

### 1. Crear el Droplet

- Ve a DigitalOcean > Droplets > Create Droplet
- **OS**: Ubuntu 24.04 (LTS)
- **Plan**: Basic ($6-$12/mes para empezar, escala segun necesites)
- **Datacenter**: Elige el mas cercano a ti (Nueva York, Frankfurt, etc.)
- **Autenticacion**: Clave SSH (recomendado) o password
- **Hostname**: `cotizador-mx` (o el que prefieras)
- Click **Create Droplet**

Anota la IP publica que te asignan (ej: `165.227.123.45`).

---

### 2. Conectarte al servidor

```bash
ssh root@TU_IP_PUBLICA
```

---

### 3. Actualizar e instalar dependencias

```bash
# Actualizar sistema
apt update && apt upgrade -y

# Instalar Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verificar
node -v   # Debe mostrar v20.x.x
npm -v    # Debe mostrar 10.x.x

# Instalar PostgreSQL
apt install -y postgresql postgresql-contrib

# Instalar Nginx
apt install -y nginx

# Instalar PM2 (para mantener el backend vivo)
npm install -g pm2

# Instalar Certbot (para SSL gratis)
apt install -y certbot python3-certbot-nginx
```

---

### 4. Configurar PostgreSQL

```bash
# Cambiar a usuario postgres
su - postgres

# Crear base de datos
psql -c "CREATE DATABASE cotizador;"

# Crear usuario (cambia 'tu_password_segura' por una real)
psql -c "CREATE USER cotizador_user WITH ENCRYPTED PASSWORD 'tu_password_segura';"

# Dar permisos
psql -c "GRANT ALL PRIVILEGES ON DATABASE cotizador TO cotizador_user;"

# Salir de postgres
exit
```

---

### 5. Crear estructura de carpetas

```bash
# Crear carpeta de la app
mkdir -p /var/www/cotizador
cd /var/www/cotizador
```

---

### 6. Subir los archivos del proyecto

**Desde tu computadora local**, abre otra terminal y ejecuta:

```bash
# Ajusta la ruta si tu proyecto esta en otra ubicacion
scp /ruta/a/tu/cotizador-china/* root@TU_IP_PUBLICA:/var/www/cotizador/
```

O si prefieres comprimir primero:

```bash
# En tu computadora
cd /ruta/a/tu/cotizador-china
tar czf cotizador.tar.gz *
scp cotizador.tar.gz root@TU_IP_PUBLICA:/var/www/cotizador/

# En el servidor
ssh root@TU_IP_PUBLICA
cd /var/www/cotizador
tar xzf cotizador.tar.gz
rm cotizador.tar.gz
```

---

### 7. Crear archivo de variables de entorno

```bash
cd /var/www/cotizador
nano .env
```

Pega esto (ajusta los valores):

```env
PORT=4000
DATABASE_URL=postgresql://cotizador_user:tu_password_segura@localhost:5432/cotizador
```

Guarda con `Ctrl+O`, `Enter`, `Ctrl+X`.

---

### 8. Instalar dependencias del backend y crear tablas

```bash
cd /var/www/cotizador
npm install

# Crear las tablas en PostgreSQL
sudo -u postgres psql -d cotizador -f schema.sql
```

Deberias ver mensajes de `CREATE TABLE` sin errores.

---

### 9. Configurar Nginx

```bash
nano /etc/nginx/sites-available/cotizador
```

Pega esto (reemplaza `TU_IP_PUBLICA` o usa tu dominio si ya lo tienes):

```nginx
server {
    listen 80;
    server_name TU_IP_PUBLICA;  # O tu-dominio.com si ya lo tienes

    # Servir el frontend (SPA estatica)
    location / {
        root /var/www/cotizador;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Proxy al backend API
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Activar el sitio:

```bash
ln -s /etc/nginx/sites-available/cotizador /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default  # Quitar el default
nginx -t  # Verificar sintaxis
systemctl restart nginx
```

---

### 10. Iniciar el backend con PM2

```bash
cd /var/www/cotizador
pm2 start server.js --name cotizador-api

# Guardar configuracion para que arranque automaticamente
pm2 startup systemd
pm2 save
```

Verificar que funciona:

```bash
curl http://127.0.0.1:4000/api/health
# Debe responder: {"ok":true,"db":"up"}
```

---

### 11. Configurar el frontend para usar el API

Edita `index.html` y cambia la linea donde se configura `apiBase`:

```bash
nano /var/www/cotizador/index.html
```

En `app.js`, busca donde se lee `LS_KEYS.api` y asegurate de que si no hay API configurada, use la misma URL:

El frontend ya detecta automaticamente: si la API responde, la usa; si no, usa localStorage. Pero para produccion, configura la URL del backend en Configuracion > URL del Backend API:

```
http://TU_IP_PUBLICA/api
```

O deja vacio y el frontend intentara `/api/` relativo al mismo dominio (lo cual funciona perfecto con la configuracion de Nginx arriba).

---

### 12. (Opcional pero recomendado) SSL con Let's Encrypt

Si ya tienes un dominio apuntando a tu IP:

```bash
certbot --nginx -d tu-dominio.com
```

Sigue las instrucciones. Certbot configurara automaticamente HTTPS y redireccion de HTTP a HTTPS.

Verificar renovacion automatica:

```bash
certbot renew --dry-run
```

---

### 13. Migrar datos de localStorage a PostgreSQL

Si tienes datos guardados en el navegador (localStorage) y quieres pasarlos al servidor:

**Opcion 1: Manual (recomendada para pocos productos)**
1. Ve a tu app desplegada
2. Configuracion > URL del Backend API: dejalo vacio o pon `/api`
3. La app detectara la API y empezara a guardar ahi
4. Los datos nuevos se guardan en PostgreSQL
5. Los datos viejos quedan en localStorage

**Opcion 2: Script de migracion (para muchos datos)**

Abre la consola del navegador (F12) en tu app actual y ejecuta:

```javascript
// Exportar todos los datos de localStorage
const data = {
  productos: JSON.parse(localStorage.getItem('cim_productos') || '[]'),
  consolidados: JSON.parse(localStorage.getItem('cim_consolidados') || '[]'),
  proveedores: JSON.parse(localStorage.getItem('cim_proveedores') || '[]'),
  pagos: JSON.parse(localStorage.getItem('cim_pagos') || '[]')
};
console.log(JSON.stringify(data));
```

Copia el JSON resultante, guardalo en un archivo en el servidor y crea un script de importacion.

---

### 14. Comandos utiles para mantenimiento

```bash
# Ver logs del backend
pm2 logs cotizador-api

# Reiniciar backend
pm2 restart cotizador-api

# Estado del backend
pm2 status

# Ver logs de Nginx
journalctl -u nginx -f

# Backup de la base de datos
sudo -u postgres pg_dump cotizador > backup_$(date +%Y%m%d).sql

# Restaurar backup
sudo -u postgres psql cotizador < backup_20250115.sql

# Actualizar app (despues de cambios)
cd /var/www/cotizador
# Sube los nuevos archivos
npm install  # si hay nuevas dependencias
pm2 restart cotizador-api
```

---

## Opcion B: DigitalOcean App Platform (Mas simple, menos control)

1. Ve a DigitalOcean > Apps > Create App
2. Elige **GitHub** y conecta tu repositorio (necesitas subir el codigo a GitHub primero)
3. O elige **Source Code** y sube un ZIP
4. Configura:
   - **Run Command**: `node server.js`
   - **HTTP Port**: `4000`
   - **Build Command**: `npm install`
5. Agrega una base de datos PostgreSQL:
   - Create > Databases > PostgreSQL
   - Conectala a tu App
6. Deploy

Nota: En App Platform, el frontend y backend van juntos. Necesitas ajustar el `server.js` para servir el `index.html` estatico, o subir el frontend como un static site separado.

---

## Firewall recomendado

```bash
# Solo permitir HTTP, HTTPS y SSH
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
ufw status
```

---

## Estructura final en el servidor

```
/var/www/cotizador/
|-- index.html          # Frontend SPA
|-- app.js              # Logica del frontend
|-- styles.css          # Estilos
|-- server.js           # Backend API
|-- schema.sql          # Estructura de BD
|-- package.json        # Dependencias
|-- package-lock.json   # Lock de dependencias
|-- .env                # Variables de entorno (NO subir a Git)
|-- .env.example        # Plantilla de .env (si subes a Git)
```

---

## URLs de acceso

| Servicio | URL |
|----------|-----|
| App (frontend) | `http://TU_IP_PUBLICA` |
| API health | `http://TU_IP_PUBLICA/api/health` |
| API productos | `http://TU_IP_PUBLICA/api/productos` |

Con dominio + SSL:
| App | `https://tu-dominio.com` |
| API | `https://tu-dominio.com/api/...` |

---

## Resumen de comandos rapido

```bash
# 1. Conectar
ssh root@TU_IP

# 2. Instalar todo
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs postgresql postgresql-contrib nginx npm
npm install -g pm2

# 3. PostgreSQL
su - postgres
psql -c "CREATE DATABASE cotizador;"
psql -c "CREATE USER cotizador_user WITH ENCRYPTED PASSWORD 'TU_PASSWORD';"
psql -c "GRANT ALL PRIVILEGES ON DATABASE cotizador TO cotizador_user;"
exit

# 4. Subir archivos (desde tu PC)
scp * root@TU_IP:/var/www/cotizador/

# 5. Backend
cd /var/www/cotizador
npm install
echo "PORT=4000\nDATABASE_URL=postgresql://cotizador_user:TU_PASSWORD@localhost:5432/cotizador" > .env
sudo -u postgres psql -d cotizador -f schema.sql
pm2 start server.js --name cotizador-api
pm2 save
pm2 startup

# 6. Nginx
nano /etc/nginx/sites-available/cotizador
# (pegar configuracion)
ln -s /etc/nginx/sites-available/cotizador /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

# 7. Firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

---

Si necesitas ayuda con algun paso especifico, dime cual y te lo detallo mas.
