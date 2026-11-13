/* =====================================================================
   Cotizador de Importaciones China → México — Backend API
   Node.js + Express + PostgreSQL  (DigitalOcean Droplet / App Platform)
   ===================================================================== */
'use strict';
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const PORT = process.env.PORT || 4000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.use(cors());

/* Log body para diagnosticar errores (NO consume el stream) */
app.use(express.json({
  verify: (req, res, buf) => { req.rawBuf = buf; }
}));

app.use((req, res, next) => {
  if ((req.method === 'POST' || req.method === 'PUT') && req.rawBuf) {
    console.log(`[${req.method}] ${req.url} | Body:`, req.rawBuf.toString('utf-8').slice(0, 500));
  }
  next();
});

/* Capturar errores de JSON malformado */
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('JSON parse error:', err.message);
    console.error('Raw body received:', req.rawBuf ? req.rawBuf.toString('utf-8') : '(empty)');
    return res.status(400).json({ error: 'JSON malformado', detail: err.message, received: req.rawBuf ? req.rawBuf.toString('utf-8').slice(0, 500) : '(empty)' });
  }
  next(err);
});

/* ---------- Salud ---------- */
app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'up' }); }
  catch { res.status(503).json({ ok: false, db: 'down' }); }
});

/* ---------- Config ---------- */
app.get('/api/config', async (_req, res) => {
  const { rows } = await pool.query("SELECT key, value FROM config WHERE key IN ('tarifa_m3','modo_cobro')");
  const cfg = { tarifa_m3: 800, modo_cobro: 'fraccion' };
  rows.forEach(r => {
    if (r.key === 'tarifa_m3') cfg.tarifa_m3 = parseFloat(r.value);
    if (r.key === 'modo_cobro') cfg.modo_cobro = r.value;
  });
  res.json(cfg);
});

app.put('/api/config', async (req, res) => {
  const { tarifa_m3, modo_cobro } = req.body;
  if (!(Number(tarifa_m3) > 0)) return res.status(400).json({ error: 'tarifa_m3 inválida' });
  await pool.query(
    "INSERT INTO config (key, value) VALUES ('tarifa_m3', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [tarifa_m3]);
  if (modo_cobro && ['fraccion', 'completo'].includes(modo_cobro)) {
    await pool.query(
      "INSERT INTO config (key, value) VALUES ('modo_cobro', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [modo_cobro]);
  }
  res.json({ ok: true, tarifa_m3, modo_cobro });
});

/* ---------- Productos ---------- */
app.get('/api/productos', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, concepto, largo_cm, ancho_cm, alto_cm, cajas, piezas_por_caja,
            precio_exw, precio_exw_moneda, peso_kg, costo_yiwu, costo_yiwu_moneda,
            tc_ref, incluir_gestor, volumen_directo, volumen_m3, estado,
            proveedor, anticipos, consolidado_id, created_at
     FROM productos ORDER BY created_at DESC`);
  res.json(rows.map(r => ({ ...r, proveedor: r.proveedor || {}, anticipos: r.anticipos || [] })));
});

app.post('/api/productos', async (req, res) => {
  const p = req.body;
  const err = validarProducto(p);
  if (err) return res.status(400).json({ error: err });
  const { rows } = await pool.query(
    `INSERT INTO productos (id, concepto, largo_cm, ancho_cm, alto_cm, cajas, piezas_por_caja,
       precio_exw, precio_exw_moneda, peso_kg, costo_yiwu, costo_yiwu_moneda, tc_ref, incluir_gestor,
       volumen_directo, volumen_m3, estado, proveedor, anticipos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [p.id || genId(), p.concepto, p.largo_cm || 0, p.ancho_cm || 0, p.alto_cm || 0, p.cajas, p.piezas_por_caja,
     p.precio_exw, p.precio_exw_moneda || 'USD', p.peso_kg || 0, p.costo_yiwu, p.costo_yiwu_moneda || 'USD',
     p.tc_ref || 7.2, !!p.incluir_gestor, !!p.volumen_directo, p.volumen_m3 || null, p.estado || 'borrador_inicial',
     JSON.stringify(p.proveedor || {}), JSON.stringify(p.anticipos || [])]);
  res.status(201).json({ ...rows[0], proveedor: rows[0].proveedor || {}, anticipos: rows[0].anticipos || [] });
});

app.put('/api/productos/:id', async (req, res) => {
  const p = req.body;
  const err = validarProducto(p);
  if (err) return res.status(400).json({ error: err });
  const { rowCount } = await pool.query(
    `UPDATE productos SET concepto=$2, largo_cm=$3, ancho_cm=$4, alto_cm=$5, cajas=$6, piezas_por_caja=$7,
       precio_exw=$8, precio_exw_moneda=$9, peso_kg=$10, costo_yiwu=$11, costo_yiwu_moneda=$12, tc_ref=$13,
       incluir_gestor=$14, volumen_directo=$15, volumen_m3=$16, estado=$17, proveedor=$18, anticipos=$19, consolidado_id=$20, updated_at=NOW()
     WHERE id=$1`,
    [req.params.id, p.concepto, p.largo_cm || 0, p.ancho_cm || 0, p.alto_cm || 0, p.cajas, p.piezas_por_caja,
     p.precio_exw, p.precio_exw_moneda || 'USD', p.peso_kg || 0, p.costo_yiwu, p.costo_yiwu_moneda || 'USD',
     p.tc_ref || 7.2, !!p.incluir_gestor, !!p.volumen_directo, p.volumen_m3 || null, p.estado,
     JSON.stringify(p.proveedor || {}), JSON.stringify(p.anticipos || []), p.consolidado_id || null]);
  if (!rowCount) return res.status(404).json({ error: 'No encontrado' });
  const { rows } = await pool.query('SELECT * FROM productos WHERE id=$1', [req.params.id]);
  res.json({ ...rows[0], proveedor: rows[0].proveedor || {}, anticipos: rows[0].anticipos || [] });
});

app.delete('/api/productos/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM productos WHERE id=$1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'No encontrado' });
  res.status(204).end();
});

/* ---------- Consolidados ---------- */
/* ---------- Proveedores ---------- */
app.get('/api/proveedores', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM proveedores ORDER BY nombre ASC');
  res.json(rows);
});

app.post('/api/proveedores', async (req, res) => {
  const p = req.body;
  if (!p.nombre) return res.status(400).json({ error: 'nombre obligatorio' });
  const { rows } = await pool.query(
    `INSERT INTO proveedores (id, nombre, ciudad, telefono, contacto, trade_assurance, verified,
       anios_experiencia, calificacion, cert_ce, cert_cpc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [p.id || genId(), p.nombre, p.ciudad || null, p.telefono || null, p.contacto || null,
     !!p.trade_assurance, !!p.verified, p.anios_experiencia || null, p.calificacion || null,
     !!p.cert_ce, !!p.cert_cpc]);
  res.status(201).json(rows[0]);
});

app.put('/api/proveedores/:id', async (req, res) => {
  const p = req.body;
  if (!p.nombre) return res.status(400).json({ error: 'nombre obligatorio' });
  const { rowCount } = await pool.query(
    `UPDATE proveedores SET nombre=$2, ciudad=$3, telefono=$4, contacto=$5, trade_assurance=$6,
       verified=$7, anios_experiencia=$8, calificacion=$9, cert_ce=$10, cert_cpc=$11
     WHERE id=$1`,
    [req.params.id, p.nombre, p.ciudad || null, p.telefono || null, p.contacto || null,
     !!p.trade_assurance, !!p.verified, p.anios_experiencia || null, p.calificacion || null,
     !!p.cert_ce, !!p.cert_cpc]);
  if (!rowCount) return res.status(404).json({ error: 'No encontrado' });
  const { rows } = await pool.query('SELECT * FROM proveedores WHERE id=$1', [req.params.id]);
  res.json(rows[0]);
});

app.delete('/api/proveedores/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM proveedores WHERE id=$1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'No encontrado' });
  res.status(204).end();
});

/* ---------- Consolidados ---------- */
app.get('/api/consolidados', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM consolidados ORDER BY created_at DESC');
  for (const c of rows) {
    const items = await pool.query('SELECT * FROM consolidado_items WHERE consolidado_id=$1 ORDER BY concepto', [c.id]);
    c.items = items.rows;
  }
  res.json(rows);
});

app.post('/api/consolidados', async (req, res) => {
  const c = req.body;
  if (!c.nombre || !(Number(c.tarifa_m3) > 0) || !Array.isArray(c.items) || !c.items.length)
    return res.status(400).json({ error: 'Datos de consolidado inválidos' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO consolidados (id, nombre, tarifa_m3, modo_cobro) VALUES ($1,$2,$3,$4) RETURNING *',
      [c.id || genId(), c.nombre, c.tarifa_m3, c.modo_cobro || 'fraccion']);
    for (const it of c.items) {
      await client.query(
        `INSERT INTO consolidado_items (id, consolidado_id, producto_id, concepto, cajas, piezas_por_caja,
           largo_cm, ancho_cm, alto_cm, precio_exw, precio_exw_moneda, costo_yiwu, costo_yiwu_moneda,
           yiwu_unit, import_unit, costo_final_unit, costo_import_total, volumen, volumen_cobrado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [genId(), rows[0].id, it.producto_id, it.concepto, it.cajas, it.piezas_por_caja, it.largo_cm,
         it.ancho_cm, it.alto_cm, it.precio_exw, it.precio_exw_moneda || 'USD', it.costo_yiwu,
         it.costo_yiwu_moneda || 'USD', it.yiwu_unit, it.import_unit, it.costo_final_unit,
         it.costo_import_total, it.volumen, it.volumen_cobrado || it.volumen]);
    }
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

app.put('/api/consolidados/:id/tarifa', async (req, res) => {
  const { tarifa_m3 } = req.body;
  if (!(Number(tarifa_m3) > 0)) return res.status(400).json({ error: 'tarifa inválida' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE consolidados SET tarifa_m3=$2 WHERE id=$1', [req.params.id, tarifa_m3]);
    const { rows: items } = await client.query('SELECT * FROM consolidado_items WHERE consolidado_id=$1', [req.params.id]);
    for (const it of items) {
      const unidades = it.cajas * it.piezas_por_caja;
      const volumen = (it.largo_cm * it.ancho_cm * it.alto_cm) / 1e6 * it.cajas;
      const importTotal = volumen * tarifa_m3;
      const importUnit = unidades > 0 ? importTotal / unidades : 0;
      await client.query(
        'UPDATE consolidado_items SET import_unit=$2, costo_import_total=$3, costo_final_unit=$4, volumen=$5, volumen_cobrado=$6 WHERE id=$1',
        [it.id, importUnit, importTotal, it.precio_exw + importUnit + it.yiwu_unit, volumen, volumen]);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

/* ---------- Utilidades ---------- */
function validarProducto(p) {
  if (!p.concepto) return 'concepto obligatorio';
  if (p.volumen_directo) {
    if (!(parseFloat(p.volumen_m3) > 0)) return 'volumen_m3 inválido';
  } else {
    if (!(p.largo_cm > 0 && p.ancho_cm > 0 && p.alto_cm > 0)) return 'dimensiones inválidas';
  }
  if (!(p.cajas > 0) || !(p.piezas_por_caja > 0)) return 'cajas / piezas inválidas';
  if (!(p.precio_exw > 0)) return 'precio EXW inválido';
  if (p.estado && !['borrador_inicial', 'borrador_completo', 'comprado', 'cerrado'].includes(p.estado)) return 'estado inválido';
  return null;
}
const genId = () => require('crypto').randomUUID();

app.listen(PORT, () => console.log(`✅ API Cotizador corriendo en puerto ${PORT}`));
