// Dominio del recuento del Senado (Madrid; SPEC §6): lectura y validación de lo introducido, agrupación en listas
// y resumen. Funciones puras (sin acceso a datos ni al reloj). Las reglas de la papeleta viven en
// public/papeleta.js (las comparte la pantalla «sábana» del navegador).
import { CELDAS, MAX_MARCAS, aplicarPapeleta, clasificarPapeleta, contadoresVacios, totalesContadores } from '../public/papeleta.js';
import { formatoPorcentaje2, leerCampo } from './recuento.js';

export { CELDAS, MAX_MARCAS, aplicarPapeleta, clasificarPapeleta, contadoresVacios, totalesContadores };
export const ESCANOS = 4;
export const MODOS = ['sabana', 'totales'];
export const NOMBRE_MODO = { sabana: 'Sábana a sábana', totales: 'Totales' };
export const formatoPct = formatoPorcentaje2;
export const porcentajeSenado = (votos, validas) => (validas > 0 ? Math.round((votos * 10000) / validas) / 100 : null);

// ---------- Listas ----------
// Agrupación: texto sin espacios sobrantes ni dobles (se guarda así) y clave de comparación sin tildes ni mayúsculas.
export const limpiarAgrupacion = (texto) => String(texto ?? '').replace(/\s+/g, ' ').trim();
export const claveAgrupacion = (texto) => limpiarAgrupacion(texto).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Clave de lista de un candidato: su partido, o su agrupación (mismo texto normalizado = misma lista), o él solo.
export function claveLista(c) {
  if (c.candidatura_id) return `p:${c.candidatura_id}`;
  const agrupacion = claveAgrupacion(c.agrupacion);
  return agrupacion ? `a:${agrupacion}` : `c:${c.id}`;
}

// Partido o agrupación de un candidato, para mostrarlo junto a su nombre.
export const partidoDe = (c) => c.partido_siglas || c.partido_nombre || limpiarAgrupacion(c.agrupacion) || '';

// Listas en el orden de su primer candidato; dentro de cada una, por orden. Solo candidatos recibidos.
export function agruparEnListas(candidatos) {
  const mapa = new Map();
  for (const c of [...candidatos].sort((a, b) => a.orden - b.orden || a.id - b.id)) {
    const clave = claveLista(c);
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        clave,
        nombre: c.partido_siglas || c.partido_nombre || c.agrupacion || c.nombre,
        color: c.color_efectivo ?? c.color,
        candidatura_id: c.candidatura_id ?? null,
        tiene_logo: Boolean(c.tiene_logo),
        logo_hash: c.logo_hash ?? null,
        candidatos: [],
      });
    }
    mapa.get(clave).candidatos.push(c);
  }
  return [...mapa.values()];
}

// ---------- Lectura ----------
// entrada: { modo, votos: {id: texto}, validas, blancas, nulas, matriz: {'1:1': texto, ...} } (todo texto).
// Devuelve valores (null = sin rellenar) y errores de formato. En «sabana» no hay «sin rellenar»: todo cuenta 0.
export function leerEntradaSenado(entrada, idsCandidatos, etiquetas = new Map()) {
  const errores = [];
  const modo = MODOS.includes(entrada.modo) ? entrada.modo : null;
  if (!modo) errores.push('Modo de recuento no válido.');
  const leer = (texto, nombre) => {
    const r = leerCampo(texto);
    if (!r.ok) {
      errores.push(`${nombre}: ${r.error}.`);
      return null;
    }
    return r.valor;
  };
  const sabana = modo === 'sabana';
  const hueco = (v) => (sabana && v === null ? 0 : v);
  const valores = {
    modo,
    votos: new Map(),
    matriz: sabana ? new Map() : null,
    validas: null,
    blancas: hueco(leer(entrada.blancas, 'Papeletas en blanco')),
    nulas: hueco(leer(entrada.nulas, 'Papeletas nulas')),
  };
  for (const id of idsCandidatos) valores.votos.set(id, hueco(leer(entrada.votos?.[id], etiquetas.get(id) ?? `Candidato ${id}`)));
  if (sabana) {
    for (const celda of CELDAS) {
      const [m, s] = celda.split(':');
      valores.matriz.set(celda, hueco(leer(entrada.matriz?.[celda], `Papeletas de ${m} marca${m === '1' ? '' : 's'}${m === '1' ? '' : s === '1' ? ' del mismo partido' : ' de partidos distintos'}`)));
    }
    valores.validas = [...valores.matriz.values()].reduce((a, v) => a + v, 0);
  } else {
    valores.validas = leer(entrada.validas, 'Papeletas válidas');
  }
  return { valores, errores };
}

export const sumaMarcas = (valores) => [...valores.votos.values()].reduce((a, v) => a + (v ?? 0), 0);
export const papeletasContadas = (valores) => (valores.validas ?? 0) + (valores.blancas ?? 0) + (valores.nulas ?? 0);

// ---------- Validación ----------
// cerrar: validación completa. En «sabana» las reglas internas se cumplen siempre por construcción, pero se
// comprueban igualmente en servidor (también en borrador). Los avisos no bloquean.
// contexto: { censo, etiquetas, listas (agruparEnListas de los candidatos), votantesCongreso, ultimaPart }
export function validarSenado({ valores, censo, etiquetas = new Map(), cerrar = false, listas = [], votantesCongreso = null, ultimaPart = null }) {
  const errores = [];
  const avisos = [];
  const suma = sumaMarcas(valores);
  const contadas = papeletasContadas(valores);
  const sabana = valores.modo === 'sabana';

  if (contadas > censo) {
    errores.push(`Las papeletas contadas (${contadas}: válidas + blancas + nulas) no pueden superar el censo de la mesa (${censo}).`);
  }
  if (sabana) {
    const { validas } = valores;
    const marcas = CELDAS.reduce((a, c) => a + Number(c[0]) * (valores.matriz.get(c) ?? 0), 0);
    if (marcas !== suma) errores.push(`Las marcas por papeleta (${marcas}) no coinciden con la suma de votos de los candidatos (${suma}): recarga la página.`);
    const maxLista = Math.max(0, ...listas.map((l) => l.candidatos.length));
    for (const k of [2, 3]) {
      if ((valores.matriz.get(`${k}:1`) ?? 0) > 0 && maxLista < k) errores.push(`Hay papeletas de ${k} marcas del mismo partido, pero ningún partido tiene ${k} candidatos.`);
    }
    for (const [id, v] of valores.votos) {
      if (v > validas) errores.push(`${etiquetas.get(id) ?? `Candidato ${id}`} tiene más votos (${v}) que papeletas válidas (${validas}).`);
    }
  } else {
    const { validas } = valores;
    if (validas !== null) {
      for (const [id, v] of valores.votos) {
        if (v !== null && v > validas) errores.push(`${etiquetas.get(id) ?? `Candidato ${id}`} tiene más votos (${v}) que papeletas válidas (${validas}).`);
      }
    }
    if (cerrar) {
      const faltan = [];
      if (validas === null) faltan.push('papeletas válidas');
      for (const [id, v] of valores.votos) if (v === null) faltan.push(etiquetas.get(id) ?? `candidato ${id}`);
      if (valores.blancas === null) faltan.push('blancas');
      if (valores.nulas === null) faltan.push('nulas');
      if (faltan.length > 0) {
        const lista = faltan.length > 6 ? `${faltan.slice(0, 6).join(', ')} y ${faltan.length - 6} más` : faltan.join(', ');
        errores.push(`Para cerrar la mesa hay que rellenar todo (0 incluido). Faltan: ${lista}.`);
      } else if (suma < validas || suma > MAX_MARCAS * validas) {
        errores.push(`La suma de votos de los candidatos (${suma}) debe estar entre las papeletas válidas (${validas}) y ${MAX_MARCAS} veces las válidas (${MAX_MARCAS * validas}).`);
      }
    }
  }
  if (errores.length === 0 || !cerrar) {
    const todoRelleno = sabana || (valores.validas !== null && valores.blancas !== null && valores.nulas !== null);
    if (todoRelleno) {
      if (votantesCongreso !== null && contadas !== votantesCongreso) {
        avisos.push(`Las papeletas contadas del Senado (${contadas}) difieren del total de votantes del Congreso de esta mesa (${votantesCongreso}).`);
      }
      if (ultimaPart && contadas !== ultimaPart.valor) {
        avisos.push(`Las papeletas contadas del Senado (${contadas}) difieren de la última participación informada (${ultimaPart.valor}, de las ${ultimaPart.hora}).`);
      }
    }
  }
  return { errores, avisos, suma, contadas };
}

// ---------- Estadística de bloque ----------
// Solo cuentan las mesas CERRADAS en modo SÁBANA (las de totales no tienen matriz de marcas y se excluyen).
// «Voto en bloque»: papeletas con todas las marcas del mismo partido o agrupación frente a «voto mixto»; se calcula
// entre las papeletas de 2 o 3 marcas (con 1 marca no hay nada que mezclar).
export function estadisticaBloque(cerradas) {
  const sabana = cerradas.filter((f) => f.cab?.modo === 'sabana');
  const m = (celda) => sabana.reduce((a, f) => a + (f.matriz.get(celda) ?? 0), 0);
  const n3 = m('3:1') + m('3:0');
  const n2 = m('2:1') + m('2:0');
  const n1 = m('1:1');
  const validas = n1 + n2 + n3;
  const enBloque = m('2:1') + m('3:1');
  const mixto = m('2:0') + m('3:0');
  const base = enBloque + mixto;
  return {
    mesasSabana: sabana.length,
    mesasCerradas: cerradas.length,
    mesasTotales: cerradas.length - sabana.length,
    validas,
    porMarcas: [3, 2, 1].map((k) => { const n = [0, n1, n2, n3][k]; return { marcas: k, papeletas: n, porcentaje: porcentajeSenado(n, validas) }; }),
    enBloque,
    mixto,
    porcentajeBloque: porcentajeSenado(enBloque, base),
    porcentajeMixto: porcentajeSenado(mixto, base),
    disponible: sabana.length > 0 && validas > 0,
  };
}

// ---------- Resumen ----------
// mesas: activas [{id, codigo, censo}]; candidatos: [{id, nombre, orden, activo, ...}] (con campos de lista);
// registros: Map mesaId -> { cab, votos: Map, matriz: Map }. SOLO las mesas CERRADAS suman en los totales.
export function construirResumenSenado({ mesas, candidatos, registros }) {
  const filasMesa = mesas.map((mesa) => {
    const r = registros.get(mesa.id) ?? null;
    return { mesa, cab: r?.cab ?? null, votos: r?.votos ?? new Map(), matriz: r?.matriz ?? new Map(), estado: !r?.cab ? 'sin_iniciar' : r.cab.estado };
  });
  const cerradas = filasMesa.filter((f) => f.estado === 'cerrado');
  const suma = (valorDe) => cerradas.reduce((a, f) => a + (valorDe(f) ?? 0), 0);

  const todos = candidatos.map((cand) => ({ cand, votos: suma((f) => f.votos.get(cand.id)) }));
  const lista = todos.filter((c) => c.cand.activo || c.votos > 0);
  const validas = suma((f) => f.cab?.validas);
  const blancas = suma((f) => f.cab?.blancas);
  const nulas = suma((f) => f.cab?.nulas);
  const conPct = lista.map((c) => ({ ...c, porcentaje: porcentajeSenado(c.votos, validas) }));
  const porVotos = [...conPct].sort((a, b) => b.votos - a.votos || a.cand.orden - b.cand.orden || a.cand.id - b.cand.id);
  const partidos = agruparEnListas(lista.map((c) => c.cand)).map((l) => {
    const votos = l.candidatos.reduce((a, c) => a + (todos.find((t) => t.cand.id === c.id)?.votos ?? 0), 0);
    return { ...l, votos, porcentaje: porcentajeSenado(votos, validas) };
  });

  return {
    mesas: filasMesa,
    totalMesas: mesas.length,
    cerradas: cerradas.length,
    borradores: filasMesa.filter((f) => f.estado === 'borrador').length,
    sinIniciar: filasMesa.filter((f) => f.estado === 'sin_iniciar').length,
    provisional: cerradas.length < mesas.length,
    bloque: estadisticaBloque(cerradas),
    candidatos: conPct,
    ranking: porVotos,
    partidos,
    validas,
    blancas,
    nulas,
    contadas: validas + blancas + nulas,
  };
}

// ---------- Texto para WhatsApp ----------
export const TOP_INDIVIDUAL = 12;
export const miles = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const MARCA_DEMO = '*** DEMO - DATOS DE PRUEBA, NO SON REALES ***';

// resumen: construirResumenSenado. Los TOP_INDIVIDUAL primeros, uno por línea; el resto SIEMPRE, en una línea compacta.
export function textoSenado({ resumen, colegio, modo, actualizado, tipoEleccion }) {
  const l = [];
  if (modo === 'DEMO') l.push(MARCA_DEMO, '');
  l.push(`*${colegio} · ${tipoEleccion}*`);
  const estado = resumen.provisional ? 'PROVISIONAL' : 'COMPLETO';
  l.push(`Senado — ${estado} (${resumen.cerradas}/${resumen.totalMesas} mesas escrutadas)`);
  if (resumen.cerradas === 0) {
    l.push('Todavía no hay mesas escrutadas.');
  } else {
    resumen.ranking.slice(0, TOP_INDIVIDUAL).forEach((c, i) => {
      const partido = partidoDe(c.cand);
      l.push(`${i + 1}. ${c.cand.nombre}${partido ? ` (${partido})` : ''}: ${miles(c.votos)} (${formatoPorcentaje2(c.porcentaje)})`);
    });
    const resto = resumen.ranking.slice(TOP_INDIVIDUAL);
    if (resto.length > 0) l.push(`Resto (${resto.length}): ${resto.map((c) => `${c.cand.nombre} ${miles(c.votos)}`).join(' · ')}`);
    l.push(`Válidas: ${miles(resumen.validas)} · En blanco: ${miles(resumen.blancas)} · Nulas: ${miles(resumen.nulas)} · *Total de papeletas: ${miles(resumen.contadas)}*`);
    const b = resumen.bloque;
    if (b.disponible && b.porcentajeBloque !== null) {
      l.push(`Voto en bloque: ${formatoPorcentaje2(b.porcentajeBloque)} · mixto: ${formatoPorcentaje2(b.porcentajeMixto)} (datos de ${b.mesasSabana}/${b.mesasCerradas} mesas)`);
    }
    l.push('(% sobre papeletas válidas; cada elector marca hasta 3 nombres)');
  }
  l.push(`Actualizado: ${actualizado} (hora de Madrid)`);
  if (modo === 'DEMO') l.push('', MARCA_DEMO);
  return l.join('\n');
}
