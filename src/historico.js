// Histórico de cambios: auditoría visible, filtrable y paginada. Nunca muestra PIN ni contraseñas.
import { ENTIDADES_CAPTURA, accionesDistintas, contarAuditoria, listarAuditoria } from './auditoria.js';

export const POR_PAGINA = 25;
export const ACTORES = { agente: 'Agente', admin: 'Administrador', sistema: 'Sistema' };

export function leerFiltros(query = {}) {
  const entero = (v) => (/^\d{1,9}$/.test(String(v ?? '')) ? Number(v) : null);
  return {
    mesa: entero(query.mesa),
    actor: Object.hasOwn(ACTORES, query.actor) ? query.actor : null,
    accion: /^[a-z_]{1,40}$/.test(String(query.accion ?? '')) ? query.accion : null,
    pagina: Math.max(1, entero(query.pagina) ?? 1),
  };
}

// Valores que nunca se enseñan aunque alguien los hubiera escrito en la auditoría.
const CLAVE_SECRETA = /(^pin$|pin_hmac|password|contrase|hash|secret|token|csrf)/i;
export function redactar(valor) {
  if (Array.isArray(valor)) return valor.map(redactar);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, CLAVE_SECRETA.test(k) ? '[oculto]' : redactar(v)]));
  }
  return valor;
}

function leerJson(texto) {
  if (texto === null || texto === undefined) return null;
  try {
    return redactar(JSON.parse(texto));
  } catch {
    return '[no legible]';
  }
}

// Texto legible de un valor (ya redactado): «codigo: 4-2-A, censo: 615» en vez de JSON.
function legible(v) {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.map(legible).join(', ');
  if (typeof v === 'object') {
    return Object.entries(v).map(([k, x]) => (x && typeof x === 'object' && !Array.isArray(x) ? `${k}: (${legible(x)})` : `${k}: ${legible(x)}`)).join(', ');
  }
  return String(v);
}
const compacto = (v) => {
  const s = legible(v);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
};

// Frase legible del cambio; si no se reconoce, el JSON (redactado y acortado).
export function describir(fila, { mesas, cortes }) {
  const antes = leerJson(fila.valor_anterior);
  const despues = leerJson(fila.valor_nuevo);
  if (fila.entidad === 'participacion') {
    const ref = despues ?? antes ?? {};
    const donde = `Mesa ${mesas.get(ref.mesa_id) ?? ref.mesa_id}, corte ${cortes.get(ref.corte_id) ?? ref.corte_id}`;
    const por = ref.introducido_por_tipo === 'admin' ? 'administrador' : ref.introducido_por_tipo === 'agente' ? 'agente' : null;
    const valor = (v) => (v === null || v === undefined ? '(vacío)' : v.votantes_acumulados);
    return `${donde}: ${valor(antes)} → ${valor(despues)}${por && despues ? ` (introducido por ${por})` : ''}`;
  }
  if (fila.entidad === 'mesa' && antes && despues && typeof antes === 'object') {
    const cambios = Object.keys(despues).filter((k) => antes[k] !== despues[k]).map((k) => `${k} ${compacto(antes[k])} → ${compacto(despues[k])}`);
    if (cambios.length) return `Mesa ${despues.codigo ?? antes.codigo}: ${cambios.join(', ')}`;
  }
  if (antes === null && despues === null) return '—';
  if (antes === null) return compacto(despues);
  if (despues === null) return `${compacto(antes)} → (eliminado)`;
  return `${compacto(antes)} → ${compacto(despues)}`;
}

// Combina la auditoría de configuración (app.db) con la de captura del modo vigente:
//  - REAL: todo está en app.db.
//  - DEMO: configuración de app.db (sin la captura real) + captura de prueba de demo.db.
export function consultarHistorico({ db, captura, filtros }) {
  const enDemo = captura.destino === 'demo';
  const excluir = enDemo ? ENTIDADES_CAPTURA : [];
  const limite = filtros.pagina * POR_PAGINA;

  const filas = listarAuditoria(db, filtros, { limite, excluirEntidades: excluir }).map((f) => ({ ...f, origen: 'config' }));
  let total = contarAuditoria(db, filtros, excluir);
  let acciones = accionesDistintas(db, excluir);
  if (enDemo) {
    filas.push(...captura.auditoria(filtros, { limite }).map((f) => ({ ...f, origen: 'demo' })));
    total += captura.contarAuditoria(filtros);
    acciones = [...new Set([...acciones, ...captura.accionesAuditoria()])].sort();
  }
  filas.sort((a, b) => (a.fecha === b.fecha ? (a.origen < b.origen ? 1 : -1) : a.fecha < b.fecha ? 1 : -1));
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pagina = Math.min(filtros.pagina, paginas);
  const desde = (pagina - 1) * POR_PAGINA;
  return { filas: filas.slice(desde, desde + POR_PAGINA), total, pagina, paginas, acciones };
}

// Contexto para describir y nombrar: mesas, cortes, agentes y administradores (app.db).
export function contextoNombres(db) {
  return {
    mesas: new Map(db.prepare('SELECT id, codigo FROM mesa').all().map((m) => [m.id, m.codigo])),
    cortes: new Map(db.prepare('SELECT id, hora FROM corte').all().map((c) => [c.id, c.hora])),
    agentes: new Map(db.prepare('SELECT id, nombre FROM agente').all().map((a) => [a.id, a.nombre])),
    admins: new Map(db.prepare('SELECT id, usuario FROM admin').all().map((a) => [a.id, a.usuario])),
  };
}

export function nombreActor(fila, nombres) {
  if (fila.actor_tipo === 'sistema') return 'Sistema';
  const mapa = fila.actor_tipo === 'agente' ? nombres.agentes : nombres.admins;
  const nombre = mapa.get(fila.actor_id) ?? `#${fila.actor_id}`;
  return `${ACTORES[fila.actor_tipo] ?? fila.actor_tipo} ${nombre}`;
}
