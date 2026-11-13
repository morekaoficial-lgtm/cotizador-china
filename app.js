/* =====================================================================
   Cotizador de Importaciones China → México
   Frontend con fallback automático: Backend API → localStorage
   ===================================================================== */
'use strict';

/* ---------- Constantes y estado global ---------- */
const LS_KEYS = {
  tarifa: 'cim_tarifa', api: 'cim_api_base', productos: 'cim_productos',
  consolidados: 'cim_consolidados', pagos: 'cim_pagos', proveedores: 'cim_proveedores'
};

const COMISION = 0.03;
const GESTOR = 0.05;

let state = {
  tarifa: 800,
  modoCobro: 'fraccion',
  tcUSDMXN: 18.2,
  productos: [],
  consolidados: [],
  pagos: [],
  proveedores: [],
  online: false,
  apiBase: '',
  filterEstado: '',
  modalId: null,
  deleteId: null,
  cierreItems: null,
  cierreTarifa: 800,
  cierreTC: 7.2,
  pagoTipo: 'anticipo',
};

const _ = id => document.getElementById(id);
const money = (n, digits = 2) => {
  const val = (typeof n === 'number' && !isNaN(n) && isFinite(n)) ? n : 0;
  return '$' + val.toLocaleString('es-MX', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const money4 = n => money(n, 4);
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const safeNum = v => { const n = parseFloat(v); return (isNaN(n) || !isFinite(n)) ? 0 : n; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
const today = () => new Date().toISOString().split('T')[0];

/* ---------- Utilidades de conversión ---------- */
function toUSD(n, moneda, tc) {
  if (moneda === 'CNY') return n / (tc || 7.2);
  return n;
}
function toCNY(usd, tc) { return usd * (tc || 7.2); }
function toMXN(usd, tcMXN) { return usd * (tcMXN || 18.2); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* Formato 3 monedas: muestra USD + CNY + MXN */
function fmt3m(usd, tcRef, tcMXN, digits) {
  const d = digits === undefined ? 2 : digits;
  const cny = toCNY(usd, tcRef);
  const mxn = toMXN(usd, tcMXN);
  return '<span class="mono-usd">' + money(usd, d) + ' USD</span>' +
    '<span class="mono-cny">' + money(cny, d) + ' CNY</span>' +
    '<span class="mono-mxn">' + money(mxn, d) + ' MXN</span>';
}
function fmt3m4(usd, tcRef, tcMXN) { return fmt3m(usd, tcRef, tcMXN, 4); }

/* ---------- Capa de datos ---------- */
async function api(path, opts = {}) {
  const url = state.apiBase + path;
  console.log('[API]', opts.method || 'GET', url, opts.body ? JSON.parse(opts.body) : '');
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch (e) {}
    console.error('[API ERROR]', res.status, detail);
    throw new Error('HTTP ' + res.status + (detail ? ': ' + detail.slice(0, 200) : ''));
  }
  return res.status === 204 ? null : res.json();
}
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function lsSet(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

async function loadAll() {
  state.apiBase = lsGet(LS_KEYS.api, '');
  state.tarifa = num(lsGet(LS_KEYS.tarifa, 800)) || 800;
  state.tcUSDMXN = num(lsGet('cim_tc_usd_mxn', 18.2)) || 18.2;
  try {
    const [cfg, productos, consolidados, proveedores] = await Promise.all([
      api('/api/config'), api('/api/productos'), api('/api/consolidados'), api('/api/proveedores')
    ]);
    state.tarifa = num(cfg.tarifa_m3) || state.tarifa;
    state.modoCobro = cfg.modo_cobro === 'completo' ? 'completo' : 'fraccion';
    state.tcUSDMXN = num(cfg.tc_usd_mxn) || state.tcUSDMXN;
    state.productos = productos || [];
    state.consolidados = consolidados || [];
    state.proveedores = proveedores || [];
    state.online = true;
  } catch {
    state.online = false;
    state.modoCobro = lsGet('cim_modo', 'fraccion') === 'completo' ? 'completo' : 'fraccion';
    state.tcUSDMXN = num(lsGet('cim_tc_usd_mxn', 18.2)) || 18.2;
    state.productos = lsGet(LS_KEYS.productos, []);
    state.consolidados = lsGet(LS_KEYS.consolidados, []);
    state.proveedores = lsGet(LS_KEYS.proveedores, []);
  }
  state.pagos = lsGet(LS_KEYS.pagos, []);
  updateConnBadge();
  updateDatalistProveedores();
  updateHistProvOptions();
}

function persistLocal() {
  if (state.online) return;
  lsSet(LS_KEYS.tarifa, state.tarifa);
  lsSet('cim_modo', state.modoCobro);
  lsSet(LS_KEYS.productos, state.productos);
  lsSet(LS_KEYS.consolidados, state.consolidados);
  lsSet(LS_KEYS.pagos, state.pagos);
  lsSet(LS_KEYS.proveedores, state.proveedores);
}

async function saveProducto(p, method) {
  if (state.online) {
    const url = method === 'POST' ? '/api/productos' : '/api/productos/' + p.id;
    console.log('[saveProducto]', method, url, 'id=', p.id);
    try {
      const resp = await api(url, { method: method || 'POST', body: JSON.stringify(p) });
      console.log('[saveProducto] OK', resp ? resp.id : 'no resp');
      // Actualizar state.productos con la respuesta del servidor
      if (resp && resp.id) {
        const idx = state.productos.findIndex(x => x.id === resp.id);
        if (idx >= 0) state.productos[idx] = resp;
        else state.productos.unshift(resp);
      }
    } catch (e) {
      console.error('[saveProducto] ERROR', e.message);
      throw e;
    }
  } else {
    const i = state.productos.findIndex(x => x.id === p.id);
    if (i >= 0) state.productos[i] = p; else state.productos.unshift(p);
    persistLocal();
  }
}

async function deleteProductoAPI(id) {
  if (state.online) { await api('/api/productos/' + id, { method: 'DELETE' }); }
  else { state.productos = state.productos.filter(p => p.id !== id); persistLocal(); }
}

async function saveConsolidado(c) {
  if (state.online) { await api('/api/consolidados', { method: 'POST', body: JSON.stringify(c) }); }
  else { state.consolidados.push(c); persistLocal(); }
}

async function saveProveedorAPI(pv) {
  if (state.online) {
    const exist = state.proveedores.find(p => p.nombre === pv.nombre);
    if (exist) {
      await api('/api/proveedores/' + exist.id, { method: 'PUT', body: JSON.stringify({ ...exist, ...pv }) });
    } else {
      await api('/api/proveedores', { method: 'POST', body: JSON.stringify(pv) });
    }
  } else {
    const i = state.proveedores.findIndex(p => p.nombre === pv.nombre);
    if (i >= 0) state.proveedores[i] = { ...state.proveedores[i], ...pv }; else state.proveedores.push(pv);
    persistLocal();
  }
}

function updateConnBadge() {
  const b = _('connBadge');
  if (state.online) { b.textContent = '\uD83D\uDFE2 Backend conectado'; b.className = 'text-xs px-3 py-1 rounded-full bg-emerald-500/90 font-medium'; }
  else { b.textContent = '\uD83D\uDCF4 Modo local (localStorage)'; b.className = 'text-xs px-3 py-1 rounded-full bg-white/20 font-medium'; }
  _('tarifaHeader').textContent = 'Tarifa: ' + money(state.tarifa) + ' / m\u00B3';
}

function updateDatalistProveedores() {
  const dl = _('datalistProveedores');
  if (!dl) return;
  dl.innerHTML = state.proveedores.map(p => '<option value="' + esc(p.nombre) + '">' + esc(p.ciudad || '') + '</option>').join('');
}

function updateHistProvOptions() {
  const sel = _('histProv');
  if (!sel) return;
  const opts = state.proveedores.map(p => '<option value="' + esc(p.nombre) + '">' + esc(p.nombre) + '</option>').join('');
  sel.innerHTML = '<option value="">Todos</option>' + opts;
}

/* =====================================================================
   MOTOR DE CÁLCULO - Nueva estructura homogeneizada
   ===================================================================== */

function calcular(p, tarifa, modo, tcRef) {
  modo = modo || state.modoCobro;
  tcRef = tcRef || 7.2;

  const totalUnidades = (p.cajas || 0) * (p.piezas_por_caja || 0);
  let volumen;
  if (p.volumen_directo && num(p.volumen_m3) > 0) {
    volumen = num(p.volumen_m3);
  } else {
    volumen = ((p.largo_cm || 0) * (p.ancho_cm || 0) * (p.alto_cm || 0)) / 1e6 * (p.cajas || 0);
  }
  const volCob = modo === 'completo' ? Math.ceil(volumen - 1e-9) : volumen;

  const importTotal = volCob * (tarifa || state.tarifa);
  const importUnit = totalUnidades > 0 ? importTotal / totalUnidades : 0;

  const exwUSD = toUSD(p.precio_exw || 0, p.precio_exw_moneda || 'USD', tcRef);
  const ywUSD = toUSD(p.costo_yiwu || 0, p.costo_yiwu_moneda || 'USD', tcRef);

  const exwUnit = exwUSD;
  const exwTotalUSD = exwUSD * totalUnidades;
  const exwTotalNeg = (p.precio_exw || 0) * totalUnidades;

  const yiwuUnit = totalUnidades > 0 ? ywUSD / totalUnidades : 0;

  // Gestor 5% sobre EXW ORIGINAL TOTAL (no sobre saldo)
  const gestorUSD = p.incluir_gestor ? exwTotalUSD * GESTOR : 0;
  const gestorUnit = totalUnidades > 0 ? gestorUSD / totalUnidades : 0;

  // Compra sin importación = EXW + Gestor + Yiwu
  const compraSinImportUnit = exwUnit + gestorUnit + yiwuUnit;
  const compraSinImportTotal = exwTotalUSD + gestorUSD + ywUSD;

  return {
    totalUnidades, volumen, volCob,
    exwUnit, exwTotalUSD, exwTotalNeg,
    gestorUnit, gestorUSD,
    yiwuUnit, ywUSD,
    importUnit, importTotal,
    compraSinImportUnit, compraSinImportTotal,
  };
}

function calcularDinero(p, tarifa, modo, tcRef) {
  const r = calcular(p, tarifa, modo, tcRef);
  const ant = Array.isArray(p.anticipos) ? p.anticipos : [];

  // Total anticipos (defensivo contra datos corruptos)
  const totalAntUSD = ant.reduce((s, a) => {
    if (!a || typeof a !== 'object') return s;
    const m = safeNum(a.monto);
    const t = safeNum(a.tc || tcRef) || 7.2;
    return s + toUSD(m, a.moneda || 'USD', t);
  }, 0);
  const totalAntCNY = ant.reduce((s, a) => s + ((a && a.moneda === 'CNY') ? safeNum(a.monto) : 0), 0);

  // Saldo al proveedor = Compra sin importación - Anticipos
  const compraSinImport = safeNum(r.compraSinImportTotal);
  const saldoProveedorUSD = Math.max(0, compraSinImport - totalAntUSD);
  const saldoProveedorUnit = r.totalUnidades > 0 ? saldoProveedorUSD / r.totalUnidades : 0;

  // Envío de dinero 3% SOBRE el saldo al proveedor
  const envioDineroUSD = saldoProveedorUSD * COMISION;
  const envioDineroUnit = r.totalUnidades > 0 ? envioDineroUSD / r.totalUnidades : 0;

  // Final MX = EXW + Gestor + Yiwu + Importación + Envío de dinero
  const finalMXUnit = safeNum(r.exwUnit) + safeNum(r.gestorUnit) + safeNum(r.yiwuUnit) + safeNum(r.importUnit) + envioDineroUnit;
  const finalMXTotal = safeNum(r.exwTotalUSD) + safeNum(r.gestorUSD) + safeNum(r.ywUSD) + safeNum(r.importTotal) + envioDineroUSD;

  // Pago al importador = Final MX Total - Anticipos
  const pagoImportador = finalMXTotal - totalAntUSD;

  return {
    ...r,
    ant, totalAntUSD, totalAntCNY,
    saldoProveedorUSD, saldoProveedorUnit,
    envioDineroUSD, envioDineroUnit,
    finalMXUnit, finalMXTotal,
    pagoImportador,
  };
}

function readForm() {
  const volumenDirecto = _('f_volumen_directo').checked;
  return {
    concepto: _('f_concepto').value.trim(),
    proveedor: _('f_proveedor').value.trim(),
    ciudad: _('f_ciudad').value.trim(),
    largo_cm: num(_('f_largo').value), ancho_cm: num(_('f_ancho').value), alto_cm: num(_('f_alto').value),
    cajas: num(_('f_cajas').value), piezas_por_caja: num(_('f_piezas').value),
    precio_exw: num(_('f_precio').value), precio_exw_moneda: _('f_precio_moneda').value,
    peso_kg: num(_('f_peso').value),
    costo_yiwu: num(_('f_yiwu').value), costo_yiwu_moneda: _('f_yiwu_moneda').value,
    tc_ref: num(_('f_tc').value) || 7.2,
    tc_usd_mxn: num(_('f_tc_mxn').value) || state.tcUSDMXN || 18.2,
    incluir_gestor: _('f_gestor').checked,
    volumen_directo: volumenDirecto,
    volumen_m3: volumenDirecto ? num(_('f_volumen_m3').value) : null,
  };
}

function validarForm(f) {
  if (!f.concepto) return 'El concepto / descripción es obligatorio.';
  if (f.volumen_directo) {
    if (!(f.volumen_m3 > 0)) return 'El volumen en m³ debe ser mayor a 0.';
  } else {
    if (!(f.largo_cm > 0) || !(f.ancho_cm > 0) || !(f.alto_cm > 0)) return 'Las dimensiones (L\u00D7A\u00D7Al) deben ser mayores a 0.';
  }
  if (!(f.cajas > 0)) return 'La cantidad de cajas debe ser mayor a 0.';
  if (!(f.piezas_por_caja > 0)) return 'Las piezas por caja deben ser mayor a 0.';
  if (!(f.precio_exw > 0)) return 'El precio de fábrica (EXW) debe ser mayor a 0.';
  if (!(f.costo_yiwu >= 0)) return 'El costo de envío a Yiwu no puede ser negativo.';
  return null;
}

/* =====================================================================
   RENDER - Cotización en vivo y tarjetas
   ===================================================================== */

function renderLive() {
  const f = readForm();
  const tcRef = num(_('f_tc').value) || 7.2;
  const r = calcularDinero(f, state.tarifa, state.modoCobro, tcRef);

  const exwTxt = f.precio_exw_moneda === 'CNY'
    ? money4(f.precio_exw) + ' CNY <span class="text-xs text-slate-400">(' + money4(r.exwUnit) + ' USD)</span>'
    : money4(f.precio_exw) + ' USD';

  const yiwuTxt = f.costo_yiwu_moneda === 'CNY'
    ? money4(f.costo_yiwu) + ' CNY <span class="text-xs text-slate-400">(' + money4(r.ywUSD) + ' USD)</span>'
    : money4(f.costo_yiwu) + ' USD';

  const rows = [
    ['Total de unidades', r.totalUnidades.toLocaleString('es-MX') + ' pzas'],
    ['Volumen total', r.volumen.toFixed(4) + ' m\u00B3'],
    ['Volumen cobrable', r.volCob.toFixed(4) + ' m\u00B3' + (state.modoCobro === 'completo' ? ' (completos)' : ' (fracción)')],
    ['', ''],
    ['\u2500\u2500 COMPRA SIN IMPORTACI\u00D3N \u2500\u2500', ''],
    ['EXW /unidad', exwTxt],
    ['Gestor local (5% EXW) /unidad', r.gestorUnit > 0.0001 ? money4(r.gestorUnit) : '\u2014'],
    ['Flete Yiwu /unidad', money4(r.yiwuUnit)],
    ['= Compra sin importación /u', '<b>' + money4(r.compraSinImportUnit) + '</b>'],
    ['', ''],
    ['\u2500\u2500 POR PEDIDO COMPLETO \u2500\u2500', ''],
    ['EXW Total', money4(r.exwTotalNeg) + ' ' + (f.precio_exw_moneda || 'USD') + ' <span class="text-xs text-slate-400">(' + money4(r.exwTotalUSD) + ' USD)</span>'],
    ['Gestor local (5% EXW) Total', r.gestorUSD > 0.0001 ? money4(r.gestorUSD) : '\u2014'],
    ['Flete Yiwu Total', yiwuTxt],
    ['= Compra sin importación Total', '<b>' + money4(r.compraSinImportTotal) + '</b>'],
  ];

  if (f.precio_exw > 0 && r.totalUnidades > 0) {
    rows.push(['', '']);
    rows.push(['\u2500\u2500 ANTICIPOS \u2500\u2500', '']);
    if (r.ant.length > 0) {
      r.ant.forEach(a => {
        rows.push(['Anticipo ' + (a.fecha || '') + ' @ TC ' + (a.tc || tcRef).toFixed(4), money4(a.monto) + ' ' + (a.moneda || 'USD')]);
      });
    } else {
      rows.push(['Sin anticipos registrados', '\u2014']);
    }
    rows.push(['Total anticipos', money4(r.totalAntUSD) + (r.totalAntCNY > 0.0001 ? ' + ' + money4(r.totalAntCNY) + ' CNY' : '')]);

    rows.push(['', '']);
    rows.push(['\u2500\u2500 SALDO AL PROVEEDOR \u2500\u2500', '']);
    rows.push(['Saldo al proveedor /unidad', money4(r.saldoProveedorUnit)]);
    rows.push(['Saldo al proveedor Total', '<b>' + money4(r.saldoProveedorUSD) + '</b>']);

    rows.push(['', '']);
    rows.push(['\u2500\u2500 ENV\u00CDO DE DINERO (3%) \u2500\u2500', '']);
    rows.push(['Comisión 3% /unidad', money4(r.envioDineroUnit)]);
    rows.push(['Comisión 3% Total', money4(r.envioDineroUSD)]);

    rows.push(['', '']);
    rows.push(['\u2500\u2500 IMPORTACI\u00D3N M\u00B3 \u2500\u2500', '']);
    rows.push(['Importación m\u00B3 /unidad', money4(r.importUnit)]);
    rows.push(['Importación m\u00B3 Total', money4(r.importTotal)]);

    rows.push(['', '']);
    rows.push(['\u2500\u2500 TOTALES \u2500\u2500', '']);
    rows.push(['A) Final MX /u', '']);
    rows.push(['  EXW /u', money4(r.exwUnit)]);
    rows.push(['  + Gestor local /u', money4(r.gestorUnit)]);
    rows.push(['  + Flete Yiwu /u', money4(r.yiwuUnit)]);
    rows.push(['  + Importación m\u00B3 /u', money4(r.importUnit)]);
    rows.push(['  + Envío de dinero 3% /u', money4(r.envioDineroUnit)]);
    rows.push(['  = Final MX /u', '<b class="text-emerald-700">' + money4(r.finalMXUnit) + '</b>']);
    rows.push(['', '']);
    rows.push(['B) Final MX /Total', '']);
    rows.push(['  EXW Total', money4(r.exwTotalUSD)]);
    rows.push(['  + Gestor local Total', money4(r.gestorUSD)]);
    rows.push(['  + Flete Yiwu Total', money4(r.ywUSD)]);
    rows.push(['  + Importación m\u00B3 Total', money4(r.importTotal)]);
    rows.push(['  + Envío de dinero 3% Total', money4(r.envioDineroUSD)]);
    rows.push(['  = Final MX /Total', '<b class="text-emerald-700">' + money4(r.finalMXTotal) + '</b>']);
    rows.push(['', '']);
    rows.push(['C) Pago al Importador', '']);
    rows.push(['  Final MX /Total', money4(r.finalMXTotal)]);
    rows.push(['  \u2212 Anticipos', money4(r.totalAntUSD)]);
    rows.push(['  = Pago al Importador', '<b class="text-blue-700">' + money4(r.pagoImportador) + '</b>']);
  }

  rows.push(['', '']);
  rows.push(['Tipo de cambio ref.', tcRef.toFixed(4) + ' \u00A5/US$']);

  _('liveResults').innerHTML = rows.map(([k, v]) =>
    v === '' && k === '' ? '<div style="height:4px"></div>' :
    '<div class="res-row"><span>' + k + '</span><b>' + v + '</b></div>').join('');

  _('r_costoFinal').textContent = f.precio_exw > 0 && r.totalUnidades > 0 ? money4(r.finalMXUnit) + ' USD' : '\u2014';
  _('r_costoTotal').textContent = f.precio_exw > 0 && r.totalUnidades > 0 ? money4(r.finalMXTotal) : '\u2014';
  _('r_tarifaUsada').textContent = money(state.tarifa) + ' / m\u00B3';
}

/* ---------- Tarjetas de producto ---------- */
const ESTADO_LABEL = { borrador_inicial: '\uD83D\uDCDD Borrador Inicial', borrador_completo: '\u2705 Borrador Completo', comprado: '\uD83D\uDED2 Comprado' };

function cardProducto(p, tipo) {
  try {
    const tcRef = p.tc_ref || 7.2;
    const tcMXN = p.tc_usd_mxn || state.tcUSDMXN || 18.2;
    const r = calcularDinero(p, state.tarifa, state.modoCobro, tcRef);
    const dataId = esc(p.id);

    const row3 = (label, usd) => '<div class="res-row"><span>' + label + '</span><div class="trio-moneda">' + fmt3m4(usd, tcRef, tcMXN) + '</div></div>';
    const row3b = (label, usd) => '<div class="res-row"><span>' + label + '</span><b>' + fmt3m4(usd, tcRef, tcMXN) + '</b></div>';
    const sep = () => '<div style="border-top:1px dashed #cbd5e1;margin:4px 0"></div>';
    const spc = () => '<div style="height:4px"></div>';

    // Desglose unitario
    let unitHtml = '<h5 class="font-semibold text-xs text-slate-500 uppercase tracking-wider mb-2">Desglose unitario</h5>' +
      row3('EXW /u', r.exwUnit) +
      (r.gestorUnit > 0.0001 ? row3('Gestor local (5%) /u', r.gestorUnit) : '') +
      row3('Flete Yiwu /u', r.yiwuUnit) +
      sep() +
      row3b('= Compra sin importación /u', r.compraSinImportUnit) +
      spc() +
      row3('Importación m³ /u', r.importUnit);

    if (r.ant.length > 0) {
      unitHtml += spc() + row3('Anticipos /u', r.totalAntUSD / r.totalUnidades);
    }

    unitHtml += spc() + row3b('Saldo al proveedor /u', r.saldoProveedorUnit) +
      row3('Envío de dinero (3%) /u', r.envioDineroUnit) +
      spc() + sep() +
      '<div class="res-row"><span><b>A) Final MX /u</b></span><span></span></div>' +
      row3('  EXW /u', r.exwUnit) +
      row3('  + Gestor /u', r.gestorUnit) +
      row3('  + Flete Yiwu /u', r.yiwuUnit) +
      row3('  + Importación /u', r.importUnit) +
      row3('  + Envío dinero /u', r.envioDineroUnit) +
      '<div class="res-row"><span><b>  = Final MX /u</b></span><div class="trio-moneda"><span class="mono-usd"><b>' + money4(r.finalMXUnit) + ' USD</b></span><span class="mono-cny">' + money4(toCNY(r.finalMXUnit, tcRef)) + ' CNY</span><span class="mono-mxn">' + money4(toMXN(r.finalMXUnit, tcMXN)) + ' MXN</span></div></div>';

    // Desglose total
    let totHtml = '<h5 class="font-semibold text-xs text-slate-500 uppercase tracking-wider mb-2">Desglose total del pedido</h5>' +
      row3('EXW Total', r.exwTotalUSD) +
      (r.gestorUSD > 0.0001 ? row3('Gestor local (5%) Total', r.gestorUSD) : '') +
      row3('Flete almacén Yiwu Total', r.ywUSD) +
      sep() +
      row3b('= Compra sin importación Total', r.compraSinImportTotal);

    if (r.ant.length > 0) {
      totHtml += spc() + sep() + '<div class="res-row"><span><b>ANTICIPOS</b></span><span></span></div>';
      r.ant.forEach(a => {
        const aUSD = toUSD(safeNum(a.monto), a.moneda || 'USD', a.tc || tcRef);
        totHtml += '<div class="res-row"><span>• ' + esc(a.fecha || '') + ' @ TC ' + (safeNum(a.tc || tcRef)).toFixed(4) + '</span><div class="trio-moneda">' + fmt3m4(aUSD, tcRef, tcMXN) + '</div></div>';
      });
      totHtml += '<div class="res-row"><span><b>Total anticipos</b></span><div class="trio-moneda">' + fmt3m4(r.totalAntUSD, tcRef, tcMXN) + '</div></div>';
    }

    totHtml += spc() + sep() + '<div class="res-row"><span><b>SALDO AL PROVEEDOR</b></span><span></span></div>' +
      row3b('Saldo al proveedor', r.saldoProveedorUSD) +
      spc() + sep() + '<div class="res-row"><span><b>ENVÍO DE DINERO (3%)</b></span><span></span></div>' +
      row3('Comisión envío de dinero 3%', r.envioDineroUSD) +
      spc() + sep() + '<div class="res-row"><span><b>IMPORTACIÓN M³</b></span><span></span></div>' +
      '<div class="res-row"><span>Importación m³ (' + r.volCob.toFixed(4) + ' m³)</span><div class="trio-moneda">' + fmt3m4(r.importTotal, tcRef, tcMXN) + '</div></div>' +
      spc() + sep() + '<div class="res-row"><span><b>B) Final MX /Total</b></span><span></span></div>' +
      row3('  EXW Total', r.exwTotalUSD) +
      row3('  + Gestor Total', r.gestorUSD) +
      row3('  + Flete Yiwu Total', r.ywUSD) +
      row3('  + Importación Total', r.importTotal) +
      row3('  + Envío dinero Total', r.envioDineroUSD) +
      '<div class="res-row"><span><b>  = Final MX /Total</b></span><div class="trio-moneda"><span class="mono-usd"><b>' + money4(r.finalMXTotal) + ' USD</b></span><span class="mono-cny">' + money4(toCNY(r.finalMXTotal, tcRef)) + ' CNY</span><span class="mono-mxn">' + money4(toMXN(r.finalMXTotal, tcMXN)) + ' MXN</span></div></div>' +
      spc() + '<div class="res-row"><span><b>C) Pago al Importador</b></span><span></span></div>' +
      row3('  Final MX /Total', r.finalMXTotal) +
      row3('  − Anticipos', r.totalAntUSD) +
      '<div class="res-row"><span><b>  = Pago al Importador</b></span><div class="trio-moneda"><span class="mono-usd"><b>' + money4(r.pagoImportador) + ' USD</b></span><span class="mono-cny">' + money4(toCNY(r.pagoImportador, tcRef)) + ' CNY</span><span class="mono-mxn">' + money4(toMXN(r.pagoImportador, tcMXN)) + ' MXN</span></div></div>';

    const badgeGestor = p.incluir_gestor ? '<span class="badge-purple">📜 Gestor local 5%</span>' : '';
    const provBadge = p.proveedor ? '<span class="badge-teal">🏭 ' + esc(p.proveedor) + '</span>' : '';

    // Botones con data-action + data-id (más robusto que onclick inline)
    let btns = '<button data-action="anticipo" data-id="' + dataId + '" class="btn-ghost text-xs px-3 py-1.5">💰 Actualizar anticipo</button>' +
      '<button data-action="editar" data-id="' + dataId + '" class="btn-ghost text-xs px-3 py-1.5">Editar</button>' +
      '<button data-action="eliminar" data-id="' + dataId + '" class="btn-danger text-xs px-3 py-1.5">Eliminar</button>';
    if (tipo === 'borrador') {
      if (p.estado === 'borrador_inicial') btns += '<button data-action="completo" data-id="' + dataId + '" class="btn-secondary text-xs px-3 py-1.5">Marcar completo</button>';
      if (p.estado === 'borrador_completo') btns += '<button data-action="comprado" data-id="' + dataId + '" class="btn-primary text-xs px-3 py-1.5">🛒 Marcar comprado</button>';
    }

    return '<div class="card">' +
      '<div class="flex flex-wrap gap-2 mb-2">' +
        '<span class="badge-blue">' + (ESTADO_LABEL[p.estado] || p.estado) + '</span>' +
        provBadge + badgeGestor +
      '</div>' +
      '<h4 class="font-semibold text-lg mb-1">' + esc(p.concepto) + '</h4>' +
      '<p class="text-sm text-slate-500 mb-3">' + (p.cajas || 0) + ' cajas × ' + (p.piezas_por_caja || 0) + ' pzas = ' + r.totalUnidades.toLocaleString('es-MX') + ' unidades · ' + r.volCob.toFixed(4) + ' m³' + (p.volumen_directo ? ' <span class="badge-purple">Volumen directo</span>' : '') + '</p>' +
      '<div class="grid md:grid-cols-2 gap-4">' +
        '<div class="bg-slate-50 p-3 rounded-lg text-sm space-y-1">' + unitHtml + '</div>' +
        '<div class="bg-slate-50 p-3 rounded-lg text-sm space-y-1">' + totHtml + '</div>' +
      '</div>' +
      '<div class="mt-3 flex gap-2 flex-wrap">' + btns + '</div>' +
    '</div>';
  } catch (e) {
    console.error('cardProducto error:', e, p);
    return '<div class="card border-red-300"><h4 class="font-semibold text-red-600">Error al renderizar: ' + esc(e.message) + '</h4><p class="text-sm text-slate-500">Producto: ' + esc(p.concepto || 'sin nombre') + '</p></div>';
  }
}
function renderBorradores() {
  const list = state.productos.filter(p => p.estado !== 'comprado' && (!state.filterEstado || p.estado === state.filterEstado))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  _('countBorradores').textContent = list.length || '';
  _('emptyBorradores').classList.toggle('hidden', list.length > 0);
  _('listaBorradores').innerHTML = list.map(p => cardProducto(p, 'borrador')).join('');
}

function renderComprados() {
  const list = state.productos.filter(p => p.estado === 'comprado' && !p.consolidado_id)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  _('countComprados').textContent = list.length || '';
  _('emptyComprados').classList.toggle('hidden', list.length > 0);
  _('listaComprados').innerHTML = list.map(p => cardProducto(p, 'comprado')).join('');
  renderCierre();
}

function marcarCompleto(id) {
  const p = state.productos.find(x => x.id === id);
  if (p) { p.estado = 'borrador_completo'; saveProducto(p, 'PUT').catch(e => console.error(e)); renderBorradores(); renderPreviewConsolidado(); }
}
function marcarComprado(id) {
  const p = state.productos.find(x => x.id === id);
  if (p) { p.estado = 'comprado'; saveProducto(p, 'PUT').catch(e => console.error(e)); renderBorradores(); renderComprados(); renderPreviewConsolidado(); }
}

/* =====================================================================
   CONSOLIDADOS, CIERRE, IMPORTADOR, PAGOS
   ===================================================================== */

function renderPreviewConsolidado() {
  const list = state.productos.filter(p => p.estado === 'comprado' && !p.consolidado_id);
  _('previewConsolidado').innerHTML = list.length === 0
    ? '<p class="text-center text-slate-400 text-sm py-4">No hay productos en estado "comprado" sin consolidar.</p>'
    : '<div class="space-y-2">' + list.map(p => {
        const tcRef = p.tc_ref || 7.2;
        const r = calcularDinero(p, state.tarifa, state.modoCobro, tcRef);
        return '<div class="p-2 border rounded-md flex justify-between items-center bg-white">' +
          '<div class="text-sm"><b>' + esc(p.concepto) + '</b> <span class="text-slate-400">(' + r.totalUnidades.toLocaleString('es-MX') + ' pzas)</span></div>' +
          '<div class="text-sm font-semibold">' + money4(r.finalMXUnit) + ' /u \u00B7 ' + money4(r.finalMXTotal) + ' total</div></div>';
      }).join('') + '</div>';
  _('previewConsolidado').classList.remove('hidden');
}

function crearConsolidado() {
  const items = state.productos.filter(p => p.estado === 'comprado' && !p.consolidado_id);
  if (items.length === 0) return alert('No hay productos comprados sin consolidar.');
  const nombre = _('c_nombre').value.trim();
  if (!nombre) return alert('El nombre del consolidado es obligatorio.');
  const tarifa = num(_('c_tarifa').value) || state.tarifa;
  const vol = items.reduce((s, p) => s + ((p.largo_cm || 0) * (p.ancho_cm || 0) * (p.alto_cm || 0) / 1e6 * (p.cajas || 0)), 0);
  const c = { id: uid(), nombre, items, tarifa_m3: tarifa, modo_cobro: state.modoCobro, created_at: new Date().toISOString(), volumen: vol };
  items.forEach(p => { p.consolidado_id = c.id; saveProducto(p, 'PUT').catch(e => console.error(e)); });
  saveConsolidado(c);
  renderComprados(); renderConsolidados(); renderPreviewConsolidado();
}

function renderConsolidados() {
  const list = state.consolidados.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  _('countConsolidados').textContent = list.length || '';
  _('emptyConsolidados').classList.toggle('hidden', list.length > 0);
  _('listaConsolidados').innerHTML = list.map(c => {
    const vol = (c.items || []).reduce((s, p) => s + ((p.largo_cm || 0) * (p.ancho_cm || 0) * (p.alto_cm || 0) / 1e6 * (p.cajas || 0)), 0);
    const tot = (c.items || []).reduce((s, p) => s + (calcularDinero(p, c.tarifa_m3, c.modo_cobro, p.tc_ref || 7.2).finalMXTotal), 0);
    return '<div class="card"><div class="flex justify-between items-start mb-2">' +
      '<div><h4 class="font-semibold">' + esc(c.nombre) + '</h4><p class="text-sm text-slate-500">' + (c.items || []).length + ' productos \u00B7 Volumen: ' + vol.toFixed(4) + ' m\u00B3</p></div>' +
      '<div class="text-right"><div class="font-bold">' + money4(tot) + ' USD</div><div class="text-xs text-slate-400">Tarifa: ' + money(c.tarifa_m3 || 800) + ' / m\u00B3</div></div></div>' +
      '<div class="mt-2 flex gap-2 flex-wrap">' +
        '<button onclick="cerrarCompraGlobal(\'' + c.id + '\')" class="btn-primary text-xs px-3 py-1.5">\uD83D\uDD12 Cerrar compra Global</button>' +
        '<button onclick="mostrarDetalleConsolidado(\'' + c.id + '\')" class="btn-ghost text-xs px-3 py-1.5">Ver productos</button>' +
      '</div></div>';
  }).join('');
}

function mostrarDetalleConsolidado(cid) {
  const c = state.consolidados.find(x => x.id === cid);
  if (!c) return;
  const html = (c.items || []).map(p => {
    const r = calcularDinero(p, c.tarifa_m3, c.modo_cobro, p.tc_ref || 7.2);
    return '<tr><td>' + esc(p.concepto) + '</td><td class="num">' + r.totalUnidades.toLocaleString('es-MX') + '</td><td class="num">' + r.volCob.toFixed(4) + ' m\u00B3</td><td class="num">' + money4(r.finalMXUnit) + '</td><td class="num font-semibold">' + money4(r.finalMXTotal) + '</td></tr>';
  }).join('');
  _('detTitulo').textContent = esc(c.nombre);
  _('detContenido').innerHTML = '<div class="overflow-x-auto"><table class="tbl"><thead><tr><th>Producto</th><th>Unidades</th><th>Volumen</th><th>Final MX/u</th><th>Final MX Total</th></tr></thead><tbody>' + html + '</tbody></table></div>';
  showModal('modalDetalle');
}

/* ---------- Cierre de compra ---------- */
function renderCierre() {
  const list = state.productos.filter(p => p.estado === 'comprado' && !p.consolidado_id);
  const items = list.map(p => {
    const d = calcularDinero(p, state.tarifa, state.modoCobro, p.tc_ref || 7.2);
    return { ...p, ...d };
  });
  if (items.length === 0) {
    _('cierreResumen').textContent = 'Sin productos pendientes.';
    _('cierreContenido').innerHTML = '';
    return;
  }
  _('cierreResumen').textContent = items.length + ' producto(s) pendiente(s) de cierre.';
  let html = '<table class="tbl"><thead><tr><th>Producto</th><th>Proveedor</th><th>EXW</th><th>Gestor 5%</th><th>Yiwu</th><th>Compra sin imp.</th><th>Anticipos</th><th>Saldo Prov.</th><th>Envío din. 3%</th><th>Import m\u00B3</th><th>Final MX</th><th>Pago importador</th></tr></thead><tbody>';
  items.forEach(it => {
    html += '<tr>' +
      '<td>' + esc(it.concepto) + '</td>' +
      '<td>' + esc(it.proveedor || 'Sin proveedor') + '</td>' +
      '<td class="num">' + money4(it.exwTotalUSD) + '</td>' +
      '<td class="num">' + money4(it.gestorUSD) + '</td>' +
      '<td class="num">' + money4(it.ywUSD) + '</td>' +
      '<td class="num">' + money4(it.compraSinImportTotal) + '</td>' +
      '<td class="num">' + money4(it.totalAntUSD) + '</td>' +
      '<td class="num">' + money4(it.saldoProveedorUSD) + '</td>' +
      '<td class="num">' + money4(it.envioDineroUSD) + '</td>' +
      '<td class="num">' + money4(it.importTotal) + '</td>' +
      '<td class="num font-semibold">' + money4(it.finalMXTotal) + '</td>' +
      '<td class="num font-bold text-blue-700">' + money4(it.pagoImportador) + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  _('cierreContenido').innerHTML = html;
}

function cerrarCompraGlobal(cid) {
  const c = state.consolidados.find(x => x.id === cid);
  if (!c) return;
  const items = state.productos.filter(p => p.consolidado_id === cid && (p.estado === 'comprado' || p.estado === 'cerrado'));
  if (items.length === 0) return alert('No hay productos comprados en este consolidado para cerrar.');
  state.cierreItems = items;
  state.cierreTarifa = c.tarifa_m3;
  state.cierreTC = num(_('f_tc').value) || 7.2;
  _('cierreNombre').textContent = esc(c.nombre);
  _('cg_tarifa').value = state.cierreTarifa;
  _('cg_tc').value = state.cierreTC;
  renderCierreGlobal();
  showScreen('screenCierre');
}

function agruparPorProveedor(items) {
  return (items || []).reduce((acc, p) => {
    const name = p.proveedor || 'Sin proveedor';
    if (!acc[name]) acc[name] = [];
    acc[name].push(p);
    return acc;
  }, {});
}

function sumarGrupo(list, tarifa, modo, tcRef) {
  return (list || []).reduce((s, p) => {
    const d = calcularDinero(p, tarifa, modo, tcRef);
    s.unidades += d.totalUnidades;
    s.volCob += d.volCob;
    s.exwTotal += d.exwTotalUSD;
    s.gestorTotal += d.gestorUSD;
    s.yiwuTotal += d.ywUSD;
    s.compraSinImport += d.compraSinImportTotal;
    s.importTotal += d.importTotal;
    s.totalAnt += d.totalAntUSD;
    s.saldoProveedor += d.saldoProveedorUSD;
    s.envioDinero += d.envioDineroUSD;
    s.finalMX += d.finalMXTotal;
    s.pagoImportador += d.pagoImportador;
    return s;
  }, { unidades: 0, volCob: 0, exwTotal: 0, gestorTotal: 0, yiwuTotal: 0, compraSinImport: 0, importTotal: 0, totalAnt: 0, saldoProveedor: 0, envioDinero: 0, finalMX: 0, pagoImportador: 0 });
}

/* ---------- Pagos al importador: calcular saldo real ---------- */
function pagosDelCierreActual() {
  const itemIds = new Set((state.cierreItems || []).map(p => p.id));
  return (state.pagos || []).filter(pg => pg.cierre_items && pg.cierre_items.some(id => itemIds.has(id)));
}

function calcularPagosAplicados() {
  const pagos = pagosDelCierreActual();
  return pagos.reduce((acc, p) => {
    const m = p.monto || 0;
    if (p.moneda === 'USD') acc.usd += m;
    else if (p.moneda === 'CNY') acc.cny += m;
    else if (p.moneda === 'MXN') {
      const tcU = p.tc_usd_mxn || 18.2;
      acc.usd += m / tcU;
      acc.mxn += m;
    }
    return acc;
  }, { usd: 0, cny: 0, mxn: 0, list: pagos });
}

function saldoImportadorReal(all) {
  const aplicados = calcularPagosAplicados();
  return {
    original: all.pagoImportador,
    pagosUSD: aplicados.usd,
    pagosCNY: aplicados.cny,
    pagosMXN: aplicados.mxn,
    pendienteUSD: Math.max(0, all.pagoImportador - aplicados.usd),
    pendienteMXN: Math.max(0, all.pagoImportador - aplicados.usd) * 18.2,
    pagosList: aplicados.list,
  };
}

function renderCierreGlobal() {
  const t = state.cierreTarifa, tcRef = state.cierreTC, modo = state.modoCobro;
  const grupos = agruparPorProveedor(state.cierreItems);
  const all = sumarGrupo(state.cierreItems, t, modo, tcRef);

  let html = '<table class="tbl"><thead><tr><th>Proveedor</th><th>Unidades</th><th>Vol m\u00B3</th><th>EXW</th><th>Gestor 5%</th><th>Yiwu</th><th>Compra sin imp.</th><th>Saldo Prov.</th><th>Envío din. 3%</th><th>Import m\u00B3</th><th>Final MX</th></tr></thead><tbody>';

  Object.keys(grupos).forEach(prov => {
    const s = sumarGrupo(grupos[prov], t, modo, tcRef);
    html += '<tr>' +
      '<td class="font-semibold">' + esc(prov) + '</td>' +
      '<td class="num">' + s.unidades.toLocaleString('es-MX') + '</td>' +
      '<td class="num">' + s.volCob.toFixed(4) + '</td>' +
      '<td class="num">' + money4(s.exwTotal) + '</td>' +
      '<td class="num">' + money4(s.gestorTotal) + '</td>' +
      '<td class="num">' + money4(s.yiwuTotal) + '</td>' +
      '<td class="num">' + money4(s.compraSinImport) + '</td>' +
      '<td class="num font-semibold">' + money4(s.saldoProveedor) + '</td>' +
      '<td class="num">' + money4(s.envioDinero) + '</td>' +
      '<td class="num">' + money4(s.importTotal) + '</td>' +
      '<td class="num font-bold">' + money4(s.finalMX) + '</td>' +
      '</tr>';
  });

  html += '<tr class="bg-slate-100 font-bold">' +
    '<td>TOTAL GLOBAL</td>' +
    '<td class="num">' + all.unidades.toLocaleString('es-MX') + '</td>' +
    '<td class="num">' + all.volCob.toFixed(4) + '</td>' +
    '<td class="num">' + money4(all.exwTotal) + '</td>' +
    '<td class="num">' + money4(all.gestorTotal) + '</td>' +
    '<td class="num">' + money4(all.yiwuTotal) + '</td>' +
    '<td class="num">' + money4(all.compraSinImport) + '</td>' +
    '<td class="num">' + money4(all.saldoProveedor) + '</td>' +
    '<td class="num">' + money4(all.envioDinero) + '</td>' +
    '<td class="num">' + money4(all.importTotal) + '</td>' +
    '<td class="num">' + money4(all.finalMX) + '</td>' +
    '</tr></tbody></table>';

  html += '<div class="mt-4 grid md:grid-cols-2 gap-4">' +
    '<div class="card bg-slate-50 space-y-2"><h4 class="font-semibold">\uD83D\uDD22 Totales seleccionables</h4>' +
    '<button class="total-click" onclick="mostrarDetalleTotal(\'unidades\')"><span>Unidades</span><b>' + all.unidades.toLocaleString('es-MX') + '</b></button>' +
    '<button class="total-click" onclick="mostrarDetalleTotal(\'volumen\')"><span>Volumen</span><b>' + all.volCob.toFixed(4) + ' m\u00B3</b></button>' +
    '<button class="total-click" onclick="mostrarDetalleTotal(\'exw\')"><span>EXW Total</span><b>' + money4(all.exwTotal) + '</b></button>' +
    '<button class="total-click" onclick="mostrarDetalleTotal(\'gestor\')"><span>Gestor local 5%</span><b>' + money4(all.gestorTotal) + '</b></button>' +
    '<button class="total-click" onclick="mostrarDetalleTotal(\'yiwu\')"><span>Flete Yiwu</span><b>' + money4(all.yiwuTotal) + '</b></button>' +
    '<button class="total-click" onclick="mostrarDetalleTotal(\'saldos\')"><span>Saldo al proveedor</span><b>' + money4(all.saldoProveedor) + '</b></button>' +
    '<button class="total-click" onclick="mostrarDetalleTotal(\'comision\')"><span>Envío de dinero 3%</span><b>' + money4(all.envioDinero) + '</b></button>' +
    '<button class="total-click" onclick="mostrarDetalleTotal(\'importacion\')"><span>Importación m\u00B3</span><b>' + money4(all.importTotal) + '</b></button>' +
    '<button class="total-click" onclick="mostrarDetalleTotal(\'anticipos\')"><span>Anticipos</span><b>' + money4(all.totalAnt) + '</b></button>' +
    '</div>' +
    '<div class="card bg-slate-50 space-y-2"><h4 class="font-semibold">\uD83D\uDCB9 Costo Final</h4>' +
    '<p class="text-2xl font-bold text-emerald-700">' + money4(all.finalMX) + ' USD</p>' +
    '<p class="text-sm text-slate-500">Sobre ' + all.unidades.toLocaleString('es-MX') + ' unidades totales</p>' +
    '<div class="border-t pt-2 text-sm space-y-1">' +
    '<div class="res-row"><span>EXW promedio/u</span><b>' + money4(all.unidades > 0 ? all.exwTotal / all.unidades : 0) + '</b></div>' +
    '<div class="res-row"><span>Gestor/u</span><b>' + money4(all.unidades > 0 ? all.gestorTotal / all.unidades : 0) + '</b></div>' +
    '<div class="res-row"><span>Flete Yiwu/u</span><b>' + money4(all.unidades > 0 ? all.yiwuTotal / all.unidades : 0) + '</b></div>' +
    '<div class="res-row"><span>Importación/u</span><b>' + money4(all.unidades > 0 ? all.importTotal / all.unidades : 0) + '</b></div>' +
    '<div class="res-row"><span>Envío dinero/u</span><b>' + money4(all.unidades > 0 ? all.envioDinero / all.unidades : 0) + '</b></div>' +
    '</div></div></div>';

  _('cierreGlobalContent').innerHTML = html;
  _('cierreTotales').innerHTML =
    '<div class="res-row font-semibold"><span>A) Final MX /u</span></div>' +
    '<div class="res-row"><span>  EXW /u</span><b>' + money4(all.unidades > 0 ? all.exwTotal / all.unidades : 0) + '</b></div>' +
    '<div class="res-row"><span>  + Gestor /u</span><b>' + money4(all.unidades > 0 ? all.gestorTotal / all.unidades : 0) + '</b></div>' +
    '<div class="res-row"><span>  + Flete Yiwu /u</span><b>' + money4(all.unidades > 0 ? all.yiwuTotal / all.unidades : 0) + '</b></div>' +
    '<div class="res-row"><span>  + Importación /u</span><b>' + money4(all.unidades > 0 ? all.importTotal / all.unidades : 0) + '</b></div>' +
    '<div class="res-row"><span>  + Envío dinero /u</span><b>' + money4(all.unidades > 0 ? all.envioDinero / all.unidades : 0) + '</b></div>' +
    '<div class="res-row font-bold text-emerald-700"><span>  = Final MX /u</span><b>' + money4(all.unidades > 0 ? all.finalMX / all.unidades : 0) + '</b></div>' +
    '<div style="height:8px"></div>' +
    '<div class="res-row font-semibold"><span>B) Final MX /Total</span></div>' +
    '<div class="res-row"><span>  EXW Total</span><b>' + money4(all.exwTotal) + '</b></div>' +
    '<div class="res-row"><span>  + Gestor Total</span><b>' + money4(all.gestorTotal) + '</b></div>' +
    '<div class="res-row"><span>  + Flete Yiwu Total</span><b>' + money4(all.yiwuTotal) + '</b></div>' +
    '<div class="res-row"><span>  + Importación Total</span><b>' + money4(all.importTotal) + '</b></div>' +
    '<div class="res-row"><span>  + Envío dinero Total</span><b>' + money4(all.envioDinero) + '</b></div>' +
    '<div class="res-row font-bold text-emerald-700"><span>  = Final MX /Total</span><b>' + money4(all.finalMX) + '</b></div>' +
    '<div style="height:8px"></div>' +
    '<div class="res-row font-semibold"><span>C) Pago al Importador</span></div>' +
    '<div class="res-row"><span>  Final MX /Total</span><b>' + money4(all.finalMX) + '</b></div>' +
    '<div class="res-row"><span>  &minus; Anticipos a proveedores</span><b>' + money4(all.totalAnt) + '</b></div>' +
    '<div class="res-row font-bold text-blue-700"><span>  = Pago al Importador (original)</span><b>' + money4(all.pagoImportador) + '</b></div>';

  /* ---------- Mostrar pagos al importador y saldo real ---------- */
  const saldoReal = saldoImportadorReal(all);
  if (saldoReal.pagosList.length > 0) {
    _('cierreTotales').innerHTML += '<div style="height:8px"></div>' +
      '<div class="res-row font-semibold text-amber-700"><span>D) Pagos realizados al importador</span></div>';
    saldoReal.pagosList.forEach(p => {
      _('cierreTotales').innerHTML += '<div class="res-row text-amber-700"><span>  &minus; ' + esc(p.fecha || '') + ' &middot; ' + esc(p.concepto || p.tipo) + '</span><b>' + money4(p.monto) + ' ' + (p.moneda || 'USD') + '</b></div>';
    });
    if (saldoReal.pagosCNY > 0.0001) {
      _('cierreTotales').innerHTML += '<div class="res-row text-amber-700"><span>  Equiv. CNY</span><b>' + money4(saldoReal.pagosCNY) + ' CNY</b></div>';
    }
    if (saldoReal.pagosMXN > 0.0001) {
      _('cierreTotales').innerHTML += '<div class="res-row text-amber-700"><span>  Equiv. MXN</span><b>' + money(saldoReal.pagosMXN) + ' MXN</b></div>';
    }
    _('cierreTotales').innerHTML += '<div class="res-row font-bold text-emerald-700"><span>  = Saldo pendiente al importador</span><b>' + money4(saldoReal.pendienteUSD) + ' USD</b></div>';
    if (saldoReal.pendienteUSD < 0.01) {
      _('cierreTotales').innerHTML += '<div class="mt-2 p-2 bg-emerald-100 text-emerald-800 rounded text-center font-semibold">&#9989; IMPORTADOR LIQUIDADO</div>';
    }
  }

  _('cierreTotalUSD').textContent = money4(saldoReal.pendienteUSD) + ' USD';
}

/* ---------- Detalle por tipo ---------- */
function mostrarDetalleTotal(tipo) {
  const t = state.cierreTarifa, tcRef = state.cierreTC, modo = state.modoCobro;
  const items = state.cierreItems;
  const grupos = agruparPorProveedor(items);
  let html = '';

  if (tipo === 'unidades') {
    html = '<table class="tbl"><thead><tr><th>Proveedor</th><th>Producto</th><th>Unidades</th></tr></thead><tbody>';
    Object.keys(grupos).forEach(prov => {
      grupos[prov].forEach((p, i) => {
        const d = calcularDinero(p, t, modo, tcRef);
        html += '<tr><td>' + (i === 0 ? esc(prov) : '') + '</td><td>' + esc(p.concepto) + '</td><td class="num">' + d.totalUnidades.toLocaleString('es-MX') + '</td></tr>';
      });
    });
    html += '</tbody></table>';
  } else if (tipo === 'volumen') {
    html = '<table class="tbl"><thead><tr><th>Proveedor</th><th>Producto</th><th>Vol cobrable m\u00B3</th></tr></thead><tbody>';
    Object.keys(grupos).forEach(prov => {
      grupos[prov].forEach((p, i) => {
        const d = calcularDinero(p, t, modo, tcRef);
        html += '<tr><td>' + (i === 0 ? esc(prov) : '') + '</td><td>' + esc(p.concepto) + '</td><td class="num">' + d.volCob.toFixed(4) + '</td></tr>';
      });
    });
    html += '</tbody></table>';
  } else if (tipo === 'exw') {
    html = '<table class="tbl"><thead><tr><th>Proveedor</th><th>Producto</th><th>EXW negociado</th><th>EXW USD</th></tr></thead><tbody>';
    Object.keys(grupos).forEach(prov => {
      grupos[prov].forEach((p, i) => {
        const d = calcularDinero(p, t, modo, tcRef);
        html += '<tr><td>' + (i === 0 ? esc(prov) : '') + '</td><td>' + esc(p.concepto) + '</td><td class="num">' + money4(d.exwTotalNeg) + ' ' + (p.precio_exw_moneda || 'USD') + '</td><td class="num font-semibold">' + money4(d.exwTotalUSD) + '</td></tr>';
      });
    });
    html += '</tbody></table>';
  } else if (tipo === 'gestor') {
    html = '<table class="tbl"><thead><tr><th>Proveedor</th><th>Producto</th><th>Gestor 5%</th></tr></thead><tbody>';
    Object.keys(grupos).forEach(prov => {
      grupos[prov].forEach((p, i) => {
        const d = calcularDinero(p, t, modo, tcRef);
        html += '<tr><td>' + (i === 0 ? esc(prov) : '') + '</td><td>' + esc(p.concepto) + '</td><td class="num">' + money4(d.gestorUSD) + '</td></tr>';
      });
    });
    html += '</tbody></table>';
  } else if (tipo === 'yiwu') {
    html = '<table class="tbl"><thead><tr><th>Proveedor</th><th>Producto</th><th>Yiwu USD</th></tr></thead><tbody>';
    Object.keys(grupos).forEach(prov => {
      grupos[prov].forEach((p, i) => {
        const d = calcularDinero(p, t, modo, tcRef);
        html += '<tr><td>' + (i === 0 ? esc(prov) : '') + '</td><td>' + esc(p.concepto) + '</td><td class="num">' + money4(d.ywUSD) + '</td></tr>';
      });
    });
    html += '</tbody></table>';
  } else if (tipo === 'saldos') {
    html = '<table class="tbl"><thead><tr><th>Proveedor</th><th>Producto</th><th>Compra sin import.</th><th>Anticipos</th><th>Saldo proveedor</th></tr></thead><tbody>';
    Object.keys(grupos).forEach(prov => {
      grupos[prov].forEach((p, i) => {
        const d = calcularDinero(p, t, modo, tcRef);
        html += '<tr><td>' + (i === 0 ? esc(prov) : '') + '</td><td>' + esc(p.concepto) + '</td><td class="num">' + money4(d.compraSinImportTotal) + '</td><td class="num">' + money4(d.totalAntUSD) + '</td><td class="num font-semibold">' + money4(d.saldoProveedorUSD) + '</td></tr>';
      });
    });
    html += '</tbody></table>';
  } else if (tipo === 'comision') {
    html = '<table class="tbl"><thead><tr><th>Proveedor</th><th>Producto</th><th>Saldo proveedor</th><th>Envío dinero 3%</th></tr></thead><tbody>';
    Object.keys(grupos).forEach(prov => {
      grupos[prov].forEach((p, i) => {
        const d = calcularDinero(p, t, modo, tcRef);
        html += '<tr><td>' + (i === 0 ? esc(prov) : '') + '</td><td>' + esc(p.concepto) + '</td><td class="num">' + money4(d.saldoProveedorUSD) + '</td><td class="num font-semibold">' + money4(d.envioDineroUSD) + '</td></tr>';
      });
    });
    html += '</tbody></table>';
  } else if (tipo === 'importacion') {
    html = '<table class="tbl"><thead><tr><th>Proveedor</th><th>Producto</th><th>Volumen cobrable</th><th>Importación</th></tr></thead><tbody>';
    Object.keys(grupos).forEach(prov => {
      grupos[prov].forEach((p, i) => {
        const d = calcularDinero(p, t, modo, tcRef);
        html += '<tr><td>' + (i === 0 ? esc(prov) : '') + '</td><td>' + esc(p.concepto) + '</td><td class="num">' + d.volCob.toFixed(4) + ' m\u00B3</td><td class="num font-semibold">' + money4(d.importTotal) + '</td></tr>';
      });
    });
    html += '</tbody></table>';
  } else if (tipo === 'anticipos') {
    html = '<table class="tbl"><thead><tr><th>Producto</th><th>Fecha</th><th>Monto</th><th>TC</th></tr></thead><tbody>';
    items.forEach(p => {
      (p.anticipos || []).forEach(a => {
        html += '<tr><td>' + esc(p.concepto) + '</td><td class="num">' + (a.fecha || '') + '</td><td class="num">' + money4(a.monto) + ' ' + (a.moneda || 'USD') + '</td><td class="num">' + (a.tc || tcRef).toFixed(4) + '</td></tr>';
      });
    });
    html += '</tbody></table>';
  }

  _('modalTitle').textContent = 'Detalle: ' + tipo.toUpperCase();
  _('modalBody').innerHTML = html;
  showModal('modalBackdrop');
}

/* ---------- Importador ---------- */
function renderImportador() {
  const tcRef = num(_('f_tc').value) || 7.2;
  const list = state.productos.filter(p => p.estado === 'comprado' || p.estado === 'cerrado').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  let html = '<table class="tbl"><thead><tr><th>Producto</th><th>Vol m\u00B3</th><th>EXW</th><th>Gestor</th><th>Yiwu</th><th>Compra sin imp.</th><th>Saldo Prov.</th><th>Envío din. 3%</th><th>Import m\u00B3</th><th>Final MX</th><th>Pago importador</th></tr></thead><tbody>';
  list.forEach(p => {
    const d = calcularDinero(p, state.tarifa, state.modoCobro, p.tc_ref || tcRef);
    html += '<tr>' +
      '<td>' + esc(p.concepto) + '</td>' +
      '<td class="num">' + d.volCob.toFixed(4) + '</td>' +
      '<td class="num">' + money4(d.exwTotalUSD) + '</td>' +
      '<td class="num">' + money4(d.gestorUSD) + '</td>' +
      '<td class="num">' + money4(d.ywUSD) + '</td>' +
      '<td class="num">' + money4(d.compraSinImportTotal) + '</td>' +
      '<td class="num">' + money4(d.saldoProveedorUSD) + '</td>' +
      '<td class="num">' + money4(d.envioDineroUSD) + '</td>' +
      '<td class="num">' + money4(d.importTotal) + '</td>' +
      '<td class="num font-semibold">' + money4(d.finalMXTotal) + '</td>' +
      '<td class="num font-bold text-blue-700">' + money4(d.pagoImportador) + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  _('importadorContenido').innerHTML = html;
}

/* =====================================================================
   REPORTES, HISTÓRICO, PROVEEDORES
   ===================================================================== */

function generarReporte(tipo) {
  const tcRef = num(_('f_tc').value) || 7.2;
  const comprados = state.productos.filter(p => p.estado === 'comprado');

  _('reporteContainer').classList.remove('hidden');
  _('reporteVacio').classList.add('hidden');

  if (tipo === 'proveedores') {
    _('reporteTitulo').textContent = '\uD83C\uDFED Balance por Proveedor';
    const grupos = agruparPorProveedor(comprados);
    let html = '<table class="tbl"><thead><tr><th>Proveedor</th><th>Productos</th><th>Unidades</th><th>EXW Total</th><th>Gestor 5%</th><th>Yiwu</th><th>Compra sin imp.</th><th>Saldo Prov.</th><th>Envío din. 3%</th><th>Import m\u00B3</th><th>Final MX</th></tr></thead><tbody>';
    let total = { productos: 0, unidades: 0, exwTotal: 0, gestor: 0, yiwu: 0, compraSinImport: 0, saldoProv: 0, envioDinero: 0, importTotal: 0, finalMX: 0 };
    Object.keys(grupos).forEach(prov => {
      const s = sumarGrupo(grupos[prov], state.tarifa, state.modoCobro, tcRef);
      total.productos += grupos[prov].length;
      total.unidades += s.unidades; total.exwTotal += s.exwTotal; total.gestor += s.gestorTotal; total.yiwu += s.yiwuTotal;
      total.compraSinImport += s.compraSinImport; total.saldoProv += s.saldoProveedor; total.envioDinero += s.envioDinero;
      total.importTotal += s.importTotal; total.finalMX += s.finalMX;
      html += '<tr>' +
        '<td>' + esc(prov) + '</td>' +
        '<td class="num">' + grupos[prov].length + '</td>' +
        '<td class="num">' + s.unidades.toLocaleString('es-MX') + '</td>' +
        '<td class="num">' + money4(s.exwTotal) + '</td>' +
        '<td class="num">' + money4(s.gestorTotal) + '</td>' +
        '<td class="num">' + money4(s.yiwuTotal) + '</td>' +
        '<td class="num">' + money4(s.compraSinImport) + '</td>' +
        '<td class="num">' + money4(s.saldoProveedor) + '</td>' +
        '<td class="num">' + money4(s.envioDinero) + '</td>' +
        '<td class="num">' + money4(s.importTotal) + '</td>' +
        '<td class="num font-bold">' + money4(s.finalMX) + '</td>' +
        '</tr>';
    });
    html += '<tr class="bg-slate-100 font-bold"><td>TOTAL</td><td class="num">' + total.productos + '</td><td class="num">' + total.unidades.toLocaleString('es-MX') + '</td><td class="num">' + money4(total.exwTotal) + '</td><td class="num">' + money4(total.gestor) + '</td><td class="num">' + money4(total.yiwu) + '</td><td class="num">' + money4(total.compraSinImport) + '</td><td class="num">' + money4(total.saldoProv) + '</td><td class="num">' + money4(total.envioDinero) + '</td><td class="num">' + money4(total.importTotal) + '</td><td class="num">' + money4(total.finalMX) + '</td></tr></tbody></table>';
    _('reporteContenido').innerHTML = html;
  } else if (tipo === 'global') {
    _('reporteTitulo').textContent = '\uD83C\uDF0D Compra Global Detallada';
    const all = sumarGrupo(comprados, state.tarifa, state.modoCobro, tcRef);
    let html = '<div class="space-y-3"><div class="grid md:grid-cols-2 gap-4">' +
      '<div class="card bg-slate-50"><h4 class="font-semibold mb-2">Resumen</h4>' +
      '<div class="res-row"><span>Productos</span><b>' + comprados.length + '</b></div>' +
      '<div class="res-row"><span>Unidades totales</span><b>' + all.unidades.toLocaleString('es-MX') + '</b></div>' +
      '<div class="res-row"><span>Volumen cobrable</span><b>' + all.volCob.toFixed(4) + ' m\u00B3</b></div>' +
      '<div class="res-row"><span>Tarifa m\u00B3</span><b>' + money(state.tarifa) + '</b></div>' +
      '<div class="res-row"><span>Modo de cobro</span><b>' + (state.modoCobro === 'completo' ? 'Completos' : 'Fracción') + '</b></div>' +
      '</div>' +
      '<div class="card bg-slate-50"><h4 class="font-semibold mb-2">Costos globales</h4>' +
      '<div class="res-row"><span>EXW Total</span><b>' + money4(all.exwTotal) + '</b></div>' +
      '<div class="res-row"><span>Gestor local 5%</span><b>' + money4(all.gestorTotal) + '</b></div>' +
      '<div class="res-row"><span>Flete Yiwu</span><b>' + money4(all.yiwuTotal) + '</b></div>' +
      '<div class="res-row"><span>= Compra sin importación</span><b>' + money4(all.compraSinImport) + '</b></div>' +
      '<div class="res-row"><span>Anticipos a proveedores</span><b>' + money4(all.totalAnt) + '</b></div>' +
      '<div class="res-row"><span>Saldo proveedor</span><b>' + money4(all.saldoProveedor) + '</b></div>' +
      '<div class="res-row"><span>Envío de dinero 3%</span><b>' + money4(all.envioDinero) + '</b></div>' +
      '<div class="res-row"><span>Importación m\u00B3</span><b>' + money4(all.importTotal) + '</b></div>' +
      '<div class="res-row text-emerald-700"><span>Final MX</span><b>' + money4(all.finalMX) + '</b></div>';

    const saldoReal = saldoImportadorReal(all);
    html += '<div class="res-row text-blue-700"><span>Pago al importador (original)</span><b>' + money4(all.pagoImportador) + '</b></div>';
    if (saldoReal.pagosList.length > 0) {
      html += '<div style="border-top:1px dashed #cbd5e1;margin:6px 0"></div>' +
        '<div class="res-row font-semibold text-amber-700"><span>Pagos al importador realizados</span></div>';
      saldoReal.pagosList.forEach(p => {
        html += '<div class="res-row text-amber-700"><span>&minus; ' + esc(p.fecha || '') + ' &middot; ' + esc(p.concepto || p.tipo) + '</span><b>' + money4(p.monto) + ' ' + (p.moneda || 'USD') + '</b></div>';
      });
      html += '<div class="res-row font-bold text-emerald-700"><span>= Saldo pendiente al importador</span><b>' + money4(saldoReal.pendienteUSD) + ' USD</b></div>';
      if (saldoReal.pendienteUSD < 0.01) {
        html += '<div class="mt-2 p-2 bg-emerald-100 text-emerald-800 rounded text-center font-semibold">&#9989; IMPORTADOR LIQUIDADO</div>';
      }
    } else {
      html += '<div class="res-row text-blue-700"><span>= Pago al importador</span><b>' + money4(all.pagoImportador) + '</b></div>';
    }
    html += '</div></div></div>';
    _('reporteContenido').innerHTML = html;
  } else if (tipo === 'importador') {
    _('reporteTitulo').textContent = '\uD83D\uDCB0 Balance al Importador';
    const all = sumarGrupo(comprados, state.tarifa, state.modoCobro, tcRef);
    const saldoReal = saldoImportadorReal(all);
    let html = '<div class="card bg-slate-50 space-y-2"><h4 class="font-semibold">\uD83D\uDCB8 Pago al Importador</h4>' +
      '<div class="res-row"><span>Final MX Total</span><b>' + money4(all.finalMX) + '</b></div>' +
      '<div class="res-row"><span>Total anticipos a proveedores</span><b>' + money4(all.totalAnt) + '</b></div>' +
      '<div class="border-t pt-2 res-row text-blue-700"><span>Pago al importador (original)</span><b>' + money4(all.pagoImportador) + '</b></div>';
    if (saldoReal.pagosList.length > 0) {
      html += '<div style="border-top:1px dashed #cbd5e1;margin:6px 0"></div>' +
        '<div class="res-row font-semibold text-amber-700"><span>Pagos al importador realizados</span></div>';
      saldoReal.pagosList.forEach(p => {
        html += '<div class="res-row text-amber-700"><span>&minus; ' + esc(p.fecha || '') + ' &middot; ' + esc(p.concepto || p.tipo) + '</span><b>' + money4(p.monto) + ' ' + (p.moneda || 'USD') + '</b></div>';
      });
      html += '<div class="res-row font-bold text-emerald-700"><span>= Saldo pendiente al importador</span><b>' + money4(saldoReal.pendienteUSD) + ' USD</b></div>';
      if (saldoReal.pendienteUSD < 0.01) {
        html += '<div class="mt-2 p-2 bg-emerald-100 text-emerald-800 rounded text-center font-semibold">&#9989; IMPORTADOR LIQUIDADO</div>';
      }
    }
    html += '</div>' +
      '<h5 class="font-semibold mt-4">Desglose por producto</h5>' +
      '<table class="tbl"><thead><tr><th>Producto</th><th>Compra sin imp.</th><th>Anticipos</th><th>Saldo Prov.</th><th>Envío din. 3%</th><th>Import m\u00B3</th><th>Final MX</th><th>Pago importador</th></tr></thead><tbody>';
    comprados.forEach(p => {
      const d = calcularDinero(p, state.tarifa, state.modoCobro, p.tc_ref || tcRef);
      html += '<tr>' +
        '<td>' + esc(p.concepto) + '</td>' +
        '<td class="num">' + money4(d.compraSinImportTotal) + '</td>' +
        '<td class="num">' + money4(d.totalAntUSD) + '</td>' +
        '<td class="num">' + money4(d.saldoProveedorUSD) + '</td>' +
        '<td class="num">' + money4(d.envioDineroUSD) + '</td>' +
        '<td class="num">' + money4(d.importTotal) + '</td>' +
        '<td class="num">' + money4(d.finalMXTotal) + '</td>' +
        '<td class="num font-semibold">' + money4(d.pagoImportador) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    _('reporteContenido').innerHTML = html;
  }
}

/* ---------- Histórico ---------- */
function generarHistorico() {
  const desde = _('histDesde').value, hasta = _('histHasta').value, prov = _('histProv').value.toLowerCase(), moneda = _('histMoneda').value;
  let list = state.productos.filter(p => p.estado === 'comprado');
  if (desde) list = list.filter(p => (p.created_at || '').slice(0, 10) >= desde);
  if (hasta) list = list.filter(p => (p.created_at || '').slice(0, 10) <= hasta);
  if (prov) list = list.filter(p => (p.proveedor || '').toLowerCase().includes(prov));
  if (moneda) list = list.filter(p => p.precio_exw_moneda === moneda);
  list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  if (list.length === 0) {
    _('historicoContenido').innerHTML = '';
    _('historicoVacio').classList.remove('hidden');
    return;
  }
  _('historicoVacio').classList.add('hidden');

  let html = '<table class="tbl"><thead><tr><th>Fecha</th><th>Concepto</th><th>Proveedor</th><th>Moneda</th><th>EXW</th><th>Gestor</th><th>Yiwu</th><th>Import m\u00B3</th><th>Envío din. 3%</th><th>Final MX</th><th>Pago importador</th></tr></thead><tbody>';
  list.forEach(p => {
    const d = calcularDinero(p, state.tarifa, state.modoCobro, p.tc_ref || 7.2);
    html += '<tr>' +
      '<td>' + (p.created_at || '').slice(0, 10) + '</td>' +
      '<td>' + esc(p.concepto) + '</td>' +
      '<td>' + esc(p.proveedor || 'Sin proveedor') + '</td>' +
      '<td>' + (p.precio_exw_moneda || 'USD') + '</td>' +
      '<td class="num">' + money4(d.exwTotalUSD) + '</td>' +
      '<td class="num">' + money4(d.gestorUSD) + '</td>' +
      '<td class="num">' + money4(d.ywUSD) + '</td>' +
      '<td class="num">' + money4(d.importTotal) + '</td>' +
      '<td class="num">' + money4(d.envioDineroUSD) + '</td>' +
      '<td class="num font-semibold">' + money4(d.finalMXTotal) + '</td>' +
      '<td class="num font-bold">' + money4(d.pagoImportador) + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  _('historicoContenido').innerHTML = html;
}

function limpiarHistorico() {
  _('histDesde').value = ''; _('histHasta').value = ''; _('histProv').value = ''; _('histMoneda').value = '';
  generarHistorico();
}

/* ---------- Proveedores ---------- */
function renderProveedores() {
  const pv = state.proveedores.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  _('emptyProveedores').classList.toggle('hidden', pv.length > 0);
  _('listaProveedores').innerHTML = pv.length === 0 ? '' :
    '<table class="tbl"><thead><tr><th>Nombre</th><th>Ciudad</th><th>Teléfono</th><th>Contacto</th><th>Trade Assurance</th><th>Verified</th><th>Años</th><th>Calif.</th><th>CE</th><th>CPC</th></tr></thead><tbody>' +
    pv.map(p => '<tr>' +
      '<td>' + esc(p.nombre) + '</td>' +
      '<td>' + esc(p.ciudad || '') + '</td>' +
      '<td>' + esc(p.telefono || '') + '</td>' +
      '<td>' + esc(p.contacto || '') + '</td>' +
      '<td class="text-center">' + (p.trade_assurance ? '\u2705' : '\u274C') + '</td>' +
      '<td class="text-center">' + (p.verified ? '\u2705' : '\u274C') + '</td>' +
      '<td class="num">' + (p.anios_experiencia || '') + '</td>' +
      '<td class="num">' + (p.calificacion || '') + '</td>' +
      '<td class="text-center">' + (p.cert_ce ? '\u2705' : '\u274C') + '</td>' +
      '<td class="text-center">' + (p.cert_cpc ? '\u2705' : '\u274C') + '</td>' +
      '</tr>').join('') + '</tbody></table>';
}

/* =====================================================================
   MODALES, CRUD, NAVEGACIÓN, EVENTOS
   ===================================================================== */

function showModal(id) {
  const el = _(id);
  if (!el) return;
  el.style.display = 'flex';
  el.classList.remove('hidden');
}
function hideModal(id) {
  const el = _(id);
  if (!el) return;
  el.style.display = 'none';
  el.classList.add('hidden');
}
function cerrarModal() { hideModal('modalProveedor'); }
function cerrarModalEliminar() { state.deleteId = null; hideModal('modalEliminar'); }
function cerrarModalDetalle() { hideModal('modalDetalle'); }
function cerrarModalAnticipo() { state.modalId = null; hideModal('modalAnticipo'); }
function volverMain() { showScreen('screenConsolidados'); }
function volverCierre() { showScreen('screenCierre'); }
function cerrarPago() { showScreen('screenCierre'); }

function abrirAnticipo(id) {
  const p = state.productos.find(x => x.id === id);
  if (!p) return;
  state.modalId = id;
  _('antInfo').textContent = p.concepto + ' \u00B7 ' + p.proveedor;
  _('antList').innerHTML = (p.anticipos || []).map((a, i) =>
    '<div class="flex justify-between items-center bg-white border rounded-md p-2 text-sm">' +
    '<span>' + (a.fecha || '') + ' \u00B7 ' + money4(a.monto) + ' ' + (a.moneda || 'USD') + ' @ TC ' + (a.tc || p.tc_ref || 7.2).toFixed(4) + '</span>' +
    '<button onclick="eliminarAnticipo(' + i + ')" class="text-red-500 text-xs">Eliminar</button></div>').join('') || '<p class="text-sm text-slate-400">Sin anticipos</p>';
  _('antMonto').value = ''; _('antMoneda').value = 'USD'; _('antTC').value = (p.tc_ref || 7.2).toFixed(4); _('antFecha').value = today();
  showModal('modalAnticipo');
}

function agregarAnticipo() {
  const monto = num(_('antMonto').value), moneda = _('antMoneda').value, tc = num(_('antTC').value) || 7.2, fecha = _('antFecha').value;
  if (monto <= 0) return alert('El monto debe ser mayor a 0.');
  const p = state.productos.find(x => x.id === state.modalId);
  if (!p) return;
  if (!p.anticipos) p.anticipos = [];
  p.anticipos.push({ monto, moneda, tc, fecha, id: uid() });
  saveProducto(p, 'PUT')
    .then(() => { renderBorradores(); renderComprados(); abrirAnticipo(state.modalId); renderImportador(); renderCierre(); })
    .catch(e => { console.error('Error agregando anticipo:', e); alert('Error al guardar anticipo: ' + e.message); });
}

function eliminarAnticipo(idx) {
  const p = state.productos.find(x => x.id === state.modalId);
  if (!p || !p.anticipos) return;
  p.anticipos.splice(idx, 1);
  saveProducto(p, 'PUT')
    .then(() => { renderBorradores(); renderComprados(); abrirAnticipo(state.modalId); renderImportador(); renderCierre(); })
    .catch(e => { console.error('Error eliminando anticipo:', e); alert('Error al eliminar anticipo: ' + e.message); });
}

function confirmDelete(id) {
  const p = state.productos.find(x => x.id === id);
  state.deleteId = id;
  _('delNombre').textContent = p ? p.concepto : '';
  showModal('modalEliminar');
}
function doDelete() {
  if (!state.deleteId) return;
  deleteProductoAPI(state.deleteId).then(() => {
    state.deleteId = null;
    hideModal('modalEliminar');
    loadAll().then(() => { renderBorradores(); renderComprados(); renderConsolidados(); renderImportador(); renderCierre(); });
  });
}

/* ---------- CRUD Producto ---------- */
function editarProducto(id) {
  const p = state.productos.find(x => x.id === id);
  if (!p) return;
  _('f_concepto').value = p.concepto || ''; _('f_proveedor').value = p.proveedor || ''; _('f_ciudad').value = p.ciudad || '';
  _('f_largo').value = p.largo_cm || ''; _('f_ancho').value = p.ancho_cm || ''; _('f_alto').value = p.alto_cm || '';
  _('f_cajas').value = p.cajas || ''; _('f_piezas').value = p.piezas_por_caja || ''; _('f_precio').value = p.precio_exw || '';
  _('f_precio_moneda').value = p.precio_exw_moneda || 'USD'; _('f_peso').value = p.peso_kg || '';
  _('f_yiwu').value = p.costo_yiwu || ''; _('f_yiwu_moneda').value = p.costo_yiwu_moneda || 'USD';
  _('f_tc').value = (p.tc_ref || 7.2).toFixed(4);
  _('f_tc_mxn').value = (p.tc_usd_mxn || state.tcUSDMXN || 18.2).toFixed(4);
  _('f_gestor').checked = !!p.incluir_gestor;
  _('f_volumen_directo').checked = !!p.volumen_directo;
  _('f_volumen_m3').value = p.volumen_m3 || '';
  toggleVolumenDirecto();
  state.modalId = id;
  renderLive();
  showTab('tab-cotizador');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function guardarCotizacion(estado) {
  const f = readForm();
  const err = validarForm(f);
  if (err) return alert(err);
  const esEdicion = !!state.modalId;
  const id = state.modalId || uid();
  const p = {
    ...f, id, estado,
    created_at: esEdicion ? (state.productos.find(x => x.id === id)?.created_at || new Date().toISOString()) : new Date().toISOString(),
    anticipos: (state.productos.find(x => x.id === id)?.anticipos || [])
  };
  const method = esEdicion ? 'PUT' : 'POST';
  saveProducto(p, method)
    .then(() => {
      state.modalId = null; limpiarForm(); renderLive();
      loadAll().then(() => { renderBorradores(); renderComprados(); renderConsolidados(); renderImportador(); renderCierre(); });
    })
    .catch(e => {
      console.error('Error guardando producto:', e);
      alert('Error al guardar: ' + (e.message || 'Error desconocido'));
    });
}

function limpiarForm() {
  _('f_concepto').value = ''; _('f_proveedor').value = ''; _('f_ciudad').value = '';
  _('f_largo').value = ''; _('f_ancho').value = ''; _('f_alto').value = '';
  _('f_cajas').value = ''; _('f_piezas').value = ''; _('f_precio').value = '';
  _('f_precio_moneda').value = 'USD'; _('f_peso').value = '';
  _('f_yiwu').value = ''; _('f_yiwu_moneda').value = 'USD';
  _('f_tc').value = '7.20'; _('f_tc_mxn').value = (state.tcUSDMXN || 18.2).toFixed(2);
  _('f_gestor').checked = false;
  _('f_volumen_directo').checked = false;
  _('f_volumen_m3').value = '';
  toggleVolumenDirecto();
  state.modalId = null;
}

function toggleVolumenDirecto() {
  const activo = _('f_volumen_directo').checked;
  _('wrapDimensiones').classList.toggle('hidden', activo);
  _('wrapVolumen').classList.toggle('hidden', !activo);
  renderLive();
}

function nuevoProducto() { state.modalId = null; limpiarForm(); renderLive(); showTab('tab-cotizador'); window.scrollTo({ top: 0, behavior: 'smooth' }); }

/* ---------- Navegación ---------- */
function showScreen(name) {
  document.querySelectorAll('.screen, .tab-panel').forEach(s => s.classList.add('hidden'));
  const el = _(name);
  if (el) el.classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach(b => {
    const active = b.dataset.tab === name;
    b.classList.toggle('tab-active', active);
  });
}

function showTab(t) {
  const map = {
    'tab-cotizador': 'tab-cotizador', 'tab-borradores': 'tab-borradores', 'tab-comprados': 'tab-comprados',
    'tab-consolidados': 'tab-consolidados', 'tab-reportes': 'tab-reportes', 'tab-config': 'tab-config'
  };
  const scr = map[t] || 'tab-cotizador';
  showScreen(scr);
  if (t === 'tab-reportes') renderImportador();
}

/* ---------- Pago screens ---------- */
function provName(p) {
  if (!p || !p.proveedor) return '';
  if (typeof p.proveedor === 'object') return p.proveedor.nombre || p.proveedor.name || '';
  return String(p.proveedor);
}

function mostrarDesgloseFinal() {
  const items = state.cierreItems;
  const t = state.cierreTarifa, tcRef = state.cierreTC, modo = state.modoCobro;
  let html = '<table class="tbl"><thead><tr><th>Producto</th><th>Proveedor</th><th>Unidades</th><th>Vol m\u00B3</th><th>Final MX/u</th><th>Subtotal MX</th><th>Anticipos</th><th>Saldo Total MX</th></tr></thead><tbody>';
  let totalSubtotal = 0, totalAnt = 0, totalSaldo = 0;
  items.forEach(p => {
    const d = calcularDinero(p, t, modo, tcRef);
    const saldo = d.finalMXTotal - d.totalAntUSD;
    totalSubtotal += d.finalMXTotal;
    totalAnt += d.totalAntUSD;
    totalSaldo += saldo;
    html += '<tr><td>' + esc(p.concepto) + '</td><td>' + esc(provName(p)) + '</td><td class="num">' + d.totalUnidades.toLocaleString('es-MX') + '</td><td class="num">' + d.volCob.toFixed(4) + '</td><td class="num">' + money4(d.finalMXUnit) + '</td><td class="num font-semibold">' + money4(d.finalMXTotal) + '</td><td class="num">' + money4(d.totalAntUSD) + '</td><td class="num font-bold text-blue-700">' + money4(saldo) + '</td></tr>';
  });
  html += '<tr class="bg-slate-100 font-bold"><td colspan="5">TOTALES</td><td class="num">' + money4(totalSubtotal) + '</td><td class="num">' + money4(totalAnt) + '</td><td class="num text-blue-700">' + money4(totalSaldo) + '</td></tr></tbody></table>';
  _('desgloseContenido').innerHTML = html;
  _('desgloseTotal').textContent = money4(totalSaldo) + ' USD';
  showScreen('screenDesglose');
}

function mostrarDinerosImportador() {
  const items = state.cierreItems;
  const tcU = num(_('di_tcu').value) || 18.2, tcC = num(_('di_tcc').value) || 2.53;
  const t = state.cierreTarifa, tcRef = state.cierreTC, modo = state.modoCobro;
  let html = '<table class="tbl"><thead><tr><th>Producto</th><th>Subtotal MX (USD)</th><th>Subtotal MX (CNY)</th><th>Anticipos (USD)</th><th>Anticipos (CNY)</th><th>Saldo (USD)</th><th>Total MXN</th></tr></thead><tbody>';
  let totalSubUSD = 0, totalSubCNY = 0, totalAntUSD = 0, totalAntCNY = 0, totalSaldoUSD = 0, totalMXN = 0;
  items.forEach(p => {
    const d = calcularDinero(p, t, modo, p.tc_ref || tcRef);
    const subCNY = d.finalMXTotal * (p.tc_ref || tcRef);
    const saldoUSD = d.pagoImportador;
    const mxn = saldoUSD * tcU;
    totalSubUSD += d.finalMXTotal;
    totalSubCNY += subCNY;
    totalAntUSD += d.totalAntUSD;
    totalAntCNY += d.totalAntCNY;
    totalSaldoUSD += saldoUSD;
    totalMXN += mxn;
    html += '<tr>' +
      '<td>' + esc(p.concepto) + '</td>' +
      '<td class="num">' + money4(d.finalMXTotal) + '</td>' +
      '<td class="num">' + money4(subCNY) + '</td>' +
      '<td class="num">' + money4(d.totalAntUSD) + '</td>' +
      '<td class="num">' + money4(d.totalAntCNY) + '</td>' +
      '<td class="num font-semibold">' + money4(saldoUSD) + '</td>' +
      '<td class="num font-bold text-emerald-700">' + money(mxn) + '</td>' +
      '</tr>';
  });
  html += '<tr class="bg-slate-100 font-bold">' +
    '<td>TOTALES</td>' +
    '<td class="num">' + money4(totalSubUSD) + '</td>' +
    '<td class="num">' + money4(totalSubCNY) + '</td>' +
    '<td class="num">' + money4(totalAntUSD) + '</td>' +
    '<td class="num">' + money4(totalAntCNY) + '</td>' +
    '<td class="num">' + money4(totalSaldoUSD) + '</td>' +
    '<td class="num text-emerald-700">' + money(totalMXN) + '</td>' +
    '</tr></tbody></table>';
  _('importadorContenido').innerHTML = html;
  _('importadorTotalMXN').textContent = money(totalMXN) + ' MXN';
  _('importadorNotaAnt').textContent = 'Saldo después de ' + money4(totalAntUSD) + ' USD + ' + money4(totalAntCNY) + ' CNY en anticipos';
  showScreen('screenImportador');
}

function mostrarPago(tipo) {
  state.pagoTipo = tipo;
  _('pagoTitulo').textContent = tipo === 'anticipo' ? '\uD83D\uDCB5 Aplicar Anticipo' : '\uD83D\uDCB3 Pago Total';
  _('pagoMonto').value = ''; _('pagoMoneda').value = 'USD';
  _('pagoTCu').value = (_('di_tcu')?.value) || '18.20';
  _('pagoTCc').value = (_('di_tcc')?.value) || '2.53';
  _('pagoFecha').value = today();
  _('pagoConcepto').value = '';
  actualizarResumenPago();
  showScreen('screenPago');
}

function actualizarResumenPago() {
  const items = state.cierreItems || [];
  const t = state.cierreTarifa, tcRef = state.cierreTC, modo = state.modoCobro;
  const all = sumarGrupo(items, t, modo, tcRef);
  const aplicados = calcularPagosAplicados();
  const saldoUSD = Math.max(0, all.pagoImportador - aplicados.usd);
  const tcU = num(_('pagoTCu').value) || 18.2;
  const tcC = num(_('pagoTCc').value) || 2.53;
  const saldoMXN = saldoUSD * tcU;
  const saldoCNY = saldoUSD * tcRef;
  const tipo = state.pagoTipo === 'anticipo' ? 'anticipo' : 'pago total';
  const monto = num(_('pagoMonto').value);
  const monedaSel = _('pagoMoneda').value || 'USD';

  let html = '<div class="space-y-2">';
  html += '<p class="font-semibold text-sm border-b pb-1">Estado de Cuenta del Importador</p>';
  html += '<div class="res-row"><span>Saldo original</span><b>' + money4(all.pagoImportador) + ' USD</b></div>';
  if (aplicados.usd > 0.0001 || aplicados.cny > 0.0001 || aplicados.mxn > 0.0001) {
    html += '<div class="res-row text-amber-700"><span>Pagos ya aplicados</span><b>\u2212 ' + money4(aplicados.usd) + ' USD</b></div>';
    if (aplicados.cny > 0.0001) html += '<div class="res-row text-amber-700"><span></span><b>\u2212 ' + money4(aplicados.cny) + ' CNY</b></div>';
    if (aplicados.mxn > 0.0001) html += '<div class="res-row text-amber-700"><span></span><b>\u2212 ' + money(aplicados.mxn) + ' MXN</b></div>';
  }
  html += '<div class="res-row text-emerald-700"><span>Saldo pendiente (USD)</span><b>' + money4(saldoUSD) + ' USD</b></div>';
  html += '<div class="res-row text-emerald-700"><span>Saldo pendiente (CNY)</span><b>' + money4(saldoCNY) + ' CNY</b></div>';
  html += '<div class="res-row text-emerald-700"><span>Saldo pendiente (MXN)</span><b>' + money(saldoMXN) + ' MXN</b></div>';

  if (aplicados.list.length > 0) {
    html += '<div class="mt-3"><p class="text-xs font-semibold text-slate-500 uppercase">Pagos registrados</p>';
    aplicados.list.forEach(p => {
      html += '<div class="flex justify-between text-xs py-1 border-b border-slate-100">' +
        '<span>' + (p.fecha || '') + ' \u00B7 ' + esc(p.concepto || p.tipo) + '</span>' +
        '<b>' + money4(p.monto) + ' ' + (p.moneda || 'USD') + '</b></div>';
    });
    html += '</div>';
  }

  if (monto > 0) {
    let montoUSD = monto;
    if (monedaSel === 'CNY') montoUSD = monto / tcRef;
    else if (monedaSel === 'MXN') montoUSD = monto / tcU;
    const nuevoSaldo = Math.max(0, saldoUSD - montoUSD);
    html += '<div style="border-top:1px dashed #cbd5e1;margin:8px 0"></div>';
    html += '<p class="font-semibold text-sm">Resumen del ' + tipo + '</p>';
    html += '<div class="res-row"><span>Monto a aplicar</span><b>' + money4(monto) + ' ' + monedaSel + '</b></div>';
    html += '<div class="res-row"><span>Equiv. USD</span><b>' + money4(montoUSD) + ' USD</b></div>';
    html += '<div class="res-row text-blue-700"><span>Nuevo saldo</span><b>' + money4(nuevoSaldo) + ' USD</b></div>';
  }
  html += '</div>';
  _('pagoResumen').innerHTML = html;
}

function guardarPago() {
  const monto = num(_('pagoMonto').value);
  const moneda = _('pagoMoneda').value;
  const tcU = num(_('pagoTCu').value) || 18.2;
  const tcC = num(_('pagoTCc').value) || 2.53;
  const fecha = _('pagoFecha').value;
  const concepto = _('pagoConcepto').value.trim();
  if (monto <= 0) return alert('El monto debe ser mayor a 0.');
  if (!fecha) return alert('La fecha es obligatoria.');

  const pago = {
    id: uid(),
    tipo: state.pagoTipo,
    monto,
    moneda,
    tc_usd_mxn: tcU,
    tc_cny_mxn: tcC,
    fecha,
    concepto: concepto || (state.pagoTipo === 'anticipo' ? 'Anticipo importador' : 'Pago total importador'),
    cierre_items: (state.cierreItems || []).map(p => p.id),
    created_at: new Date().toISOString(),
  };
  state.pagos.push(pago);
  lsSet(LS_KEYS.pagos, state.pagos);

  alert('\u2705 ' + (state.pagoTipo === 'anticipo' ? 'Anticipo' : 'Pago total') + ' de ' + money4(monto) + ' ' + moneda + ' guardado correctamente.\n\nRevisa el Estado de Cuenta para ver el saldo actualizado.');
  actualizarResumenPago();
  renderCierreGlobal();
  renderCierre();
}

function generarEstadoCuenta() {
  const items = state.cierreItems || [];
  const t = state.cierreTarifa, tcRef = state.cierreTC, modo = state.modoCobro;
  const all = sumarGrupo(items, t, modo, tcRef);
  const aplicados = calcularPagosAplicados();
  const saldoUSD = Math.max(0, all.pagoImportador - aplicados.usd);
  const tcU = num(_('di_tcu')?.value) || 18.2;
  const tcC = num(_('di_tcc')?.value) || 2.53;
  const saldoMXN = saldoUSD * tcU;
  const saldoCNY = saldoUSD * tcRef;

  let html = '<div class="space-y-4">';
  html += '<div class="text-center border-b pb-4">' +
    '<h3 class="text-xl font-bold">ESTADO DE CUENTA DEL IMPORTADOR</h3>' +
    '<p class="text-sm text-slate-500">Generado: ' + new Date().toLocaleString('es-MX') + '</p></div>';

  html += '<div class="grid md:grid-cols-2 gap-4">' +
    '<div class="card bg-slate-50"><h4 class="font-semibold mb-2">\uD83D\uDCE6 Desglose del Embarque</h4>' +
    '<div class="res-row"><span>Productos</span><b>' + items.length + '</b></div>' +
    '<div class="res-row"><span>Unidades totales</span><b>' + all.unidades.toLocaleString('es-MX') + '</b></div>' +
    '<div class="res-row"><span>Volumen cobrable</span><b>' + all.volCob.toFixed(4) + ' m\u00B3</b></div>' +
    '<div class="res-row"><span>Tarifa m\u00B3</span><b>' + money(state.tarifa) + '</b></div>' +
    '</div>' +
    '<div class="card bg-slate-50"><h4 class="font-semibold mb-2">\uD83D\uDCB9 Costos</h4>' +
    '<div class="res-row"><span>EXW Total</span><b>' + money4(all.exwTotal) + '</b></div>' +
    '<div class="res-row"><span>Gestor local 5%</span><b>' + money4(all.gestorTotal) + '</b></div>' +
    '<div class="res-row"><span>Flete Yiwu</span><b>' + money4(all.yiwuTotal) + '</b></div>' +
    '<div class="res-row"><span>Importaci\u00F3n m\u00B3</span><b>' + money4(all.importTotal) + '</b></div>' +
    '<div class="res-row"><span>Env\u00EDo de dinero 3%</span><b>' + money4(all.envioDinero) + '</b></div>' +
    '</div></div>';

  html += '<div class="card bg-emerald-50 border border-emerald-200">' +
    '<h4 class="font-semibold text-emerald-800 mb-2">\uD83D\uDCB0 Balance al Importador</h4>' +
    '<div class="res-row"><span>Final MX /Total</span><b>' + money4(all.finalMX) + ' USD</b></div>' +
    '<div class="res-row"><span>Total anticipos (a proveedores)</span><b>' + money4(all.totalAnt) + ' USD</b></div>' +
    '<div class="res-row font-bold text-emerald-800"><span>Pago al importador (original)</span><b>' + money4(all.pagoImportador) + ' USD</b></div>';

  if (aplicados.list.length > 0) {
    html += '<div style="border-top:1px dashed #10b981;margin:8px 0"></div>' +
      '<p class="text-sm font-semibold text-emerald-700">Pagos ya realizados al importador</p>';
    aplicados.list.forEach(p => {
      html += '<div class="flex justify-between text-sm py-1">' +
        '<span>' + (p.fecha || '') + ' \u2014 ' + esc(p.concepto || p.tipo) + '</span>' +
        '<b>' + money4(p.monto) + ' ' + (p.moneda || 'USD') + '</b></div>';
    });
    html += '<div class="res-row text-amber-700 mt-1"><span>Total pagado al importador</span><b>\u2212 ' + money4(aplicados.usd) + ' USD</b></div>';
  }

  html += '<div style="border-top:2px solid #10b981;margin:8px 0"></div>' +
    '<div class="res-row text-lg text-emerald-800"><span>Saldo pendiente (USD)</span><b>' + money4(saldoUSD) + ' USD</b></div>' +
    '<div class="res-row text-lg text-emerald-800"><span>Saldo pendiente (CNY)</span><b>' + money4(saldoCNY) + ' CNY</b></div>' +
    '<div class="res-row text-lg text-emerald-800"><span>Saldo pendiente (MXN)</span><b>' + money(saldoMXN) + ' MXN</b></div>';
  html += '</div>';

  html += '<div class="grid md:grid-cols-2 gap-4">' +
    '<div class="card"><h4 class="font-semibold mb-2">\uD83D\uDD04 Tipos de Cambio Aplicados</h4>' +
    '<div class="res-row"><span>USD \u2192 MXN</span><b>' + tcU.toFixed(4) + '</b></div>' +
    '<div class="res-row"><span>CNY \u2192 MXN</span><b>' + tcC.toFixed(4) + '</b></div>' +
    '<div class="res-row"><span>CNY \u2192 USD (ref)</span><b>' + tcRef.toFixed(4) + '</b></div>' +
    '</div>' +
    '<div class="card"><h4 class="font-semibold mb-2">\u2705 Estado</h4>' +
    '<p class="text-sm">' + (saldoUSD < 0.01 ? '\u2705 PAGO COMPLETO. El importador est\u00E1 liquidado.' :
      aplicados.list.length > 0 ? '\u23F3 PAGO PARCIAL. A\u00FAn hay saldo pendiente de ' + money4(saldoUSD) + ' USD.' :
      '\u23F3 PENDIENTE. No se han registrado pagos al importador.') + '</p>' +
    '</div></div>';

  html += '<div class="flex justify-center gap-3 mt-4 no-print">' +
    '<button onclick="window.print()" class="btn-primary">\uD83D\uDDA8\uFE0F Imprimir / Guardar PDF</button>' +
    '<button onclick="hideModal(\'modalBackdrop\')" class="btn-secondary">Cerrar</button></div>';
  html += '</div>';

  _('modalTitle').textContent = '\uD83D\uDCCA Estado de Cuenta Final';
  _('modalBody').innerHTML = html;
  showModal('modalBackdrop');
}

/* ---------- Event Listeners ---------- */
function bindEvents() {
  _('btnGuardarBorrador').addEventListener('click', () => guardarCotizacion('borrador_inicial'));
  _('btnBorradorCompleto').addEventListener('click', () => guardarCotizacion('borrador_completo'));
  _('btnConcretarCompra').addEventListener('click', () => guardarCotizacion('comprado'));
  _('btnCrearConsolidado').addEventListener('click', crearConsolidado);
  _('btnCierreGlobal').addEventListener('click', () => {
    const items = state.productos.filter(p => p.estado === 'comprado' && !p.consolidado_id);
    if (items.length === 0) return alert('No hay productos comprados pendientes.');
    state.cierreItems = items;
    state.cierreTarifa = state.tarifa;
    state.cierreTC = num(_('f_tc').value) || 7.2;
    _('cierreNombre').textContent = 'Cierre directo';
    _('cg_tarifa').value = state.cierreTarifa;
    _('cg_tc').value = state.cierreTC;
    renderCierreGlobal();
    showScreen('screenCierre');
  });
  _('btnGuardarConfig').addEventListener('click', () => {
    const t = num(_('cfg_tarifa').value), api = _('cfg_api').value.trim();
    if (t > 0) { state.tarifa = t; lsSet(LS_KEYS.tarifa, t); }
    state.apiBase = api; lsSet(LS_KEYS.api, api);
    state.modoCobro = _('cfg_modo').value;
    lsSet('cim_modo', state.modoCobro);
    if (api) loadAll().then(() => { renderBorradores(); renderComprados(); renderConsolidados(); renderImportador(); renderCierre(); });
    _('cfgMsg').textContent = 'Configuración guardada.'; _('cfgMsg').classList.remove('hidden');
  });
  _('btnConfirmEliminar').addEventListener('click', doDelete);
  _('btnGuardarAnticipo').addEventListener('click', agregarAnticipo);
  _('btnGuardarPago').addEventListener('click', guardarPago);

  ['pagoMonto','pagoMoneda'].forEach(id => {
    const el = _(id);
    if (el) el.addEventListener('input', actualizarResumenPago);
  });

  ['f_largo','f_ancho','f_alto','f_cajas','f_piezas','f_precio','f_precio_moneda','f_yiwu','f_yiwu_moneda','f_tc','f_tc_mxn','f_gestor','f_volumen_m3'].forEach(id => {
    const el = _(id);
    if (el) el.addEventListener('input', renderLive);
  });

  const chkVol = _('f_volumen_directo');
  if (chkVol) chkVol.addEventListener('change', toggleVolumenDirecto);

  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', e => showTab(e.currentTarget.dataset.tab)));
  document.querySelectorAll('.filter-btn').forEach(b => b.addEventListener('click', e => {
    document.querySelectorAll('.filter-btn').forEach(x => x.classList.remove('filter-active'));
    e.currentTarget.classList.add('filter-active');
    state.filterEstado = e.currentTarget.dataset.f;
    renderBorradores();
  }));

  // Delegados de eventos para botones de tarjetas (más robusto que onclick inline)
  const attachCardClicks = (containerId) => {
    const container = _(containerId);
    if (!container) return;
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action][data-id]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      console.log('[card click]', action, id);
      if (action === 'anticipo') abrirAnticipo(id);
      else if (action === 'editar') editarProducto(id);
      else if (action === 'eliminar') confirmDelete(id);
      else if (action === 'completo') marcarCompleto(id);
      else if (action === 'comprado') marcarComprado(id);
    });
  };
  attachCardClicks('listaBorradores');
  attachCardClicks('listaComprados');
}

/* ---------- Inicialización ---------- */
window.addEventListener('DOMContentLoaded', () => {
  loadAll().then(() => {
    renderBorradores(); renderComprados(); renderConsolidados(); renderImportador(); renderCierre();
    renderPreviewConsolidado(); renderProveedores(); generarHistorico(); renderLive();
    _('cfg_tarifa').value = state.tarifa; _('cfg_api').value = state.apiBase || '';
    _('cfg_modo').value = state.modoCobro;
    _('cg_tarifa').value = state.tarifa; _('cg_tc').value = 7.2;
    bindEvents();
  });
});
