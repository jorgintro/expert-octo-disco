// Dominio del recuento del Congreso (SPEC §6): lectura y validación de lo introducido, resumen y texto
// para WhatsApp. Funciones puras (sin acceso a datos ni al reloj).
import { VACIO } from './participacion.js';

export const MAX_VOTOS = 9_999_999;
export const ELECCION_TEXTO = 'Congreso';

// '' (o null) = sin rellenar; solo cifras en otro caso.
export function leerCampo(texto) {
  const t = String(texto ?? '').trim();
  if (t === '') return { ok: true, valor: null };
  if (!/^\d+$/.test(t)) return { ok: false, error: 'solo cifras (un número entero, sin signos, decimales ni letras)' };
  if (t.length > 7 || Number(t) > MAX_VOTOS) return { ok: false, error: 'el número es demasiado grande' };
  return { ok: true, valor: Number(t) };
}

// entrada: { votantes, blancos, nulos, votos: { [candidaturaId]: texto } } (todo texto).
// etiquetas: Map candidaturaId -> siglas/nombre para los mensajes. Devuelve valores (null = sin rellenar) y errores de formato.
export function leerEntrada(entrada, idsCandidaturas, etiquetas = new Map()) {
  const errores = [];
  const leer = (texto, nombre) => {
    const r = leerCampo(texto);
    if (!r.ok) {
      errores.push(`${nombre}: ${r.error}.`);
      return null;
    }
    return r.valor;
  };
  const valores = {
    votantes: leer(entrada.votantes, 'Total de votantes'),
    blancos: leer(entrada.blancos, 'Blancos'),
    nulos: leer(entrada.nulos, 'Nulos'),
    votos: new Map(),
  };
  for (const id of idsCandidaturas) {
    valores.votos.set(id, leer(entrada.votos?.[id], etiquetas.get(id) ?? `Candidatura ${id}`));
  }
  return { valores, errores };
}

export const sumaVotos = ({ votos, blancos, nulos }) =>
  [...votos.values()].reduce((a, v) => a + (v ?? 0), 0) + (blancos ?? 0) + (nulos ?? 0);

// Última participación informada de una mesa: el corte con datos más reciente (por orden).
export function ultimaParticipacion(filas, cortes) {
  let ultima = null;
  for (const corte of cortes) {
    const f = filas.find((x) => x.corte_id === corte.id);
    if (f) ultima = { valor: f.votantes_acumulados, hora: corte.hora };
  }
  return ultima;
}

// Valida lo introducido. `cerrar`: validación completa (todo relleno y la suma cuadra con el total de votantes).
// Los avisos no bloquean (difiere de la última participación informada).
export function validarRecuento({ valores, censo, etiquetas, cerrar, ultimaPart = null }) {
  const errores = [];
  const avisos = [];
  const suma = sumaVotos(valores);

  if (valores.votantes !== null && valores.votantes > censo) {
    errores.push(`El total de votantes (${valores.votantes}) no puede superar el censo de la mesa (${censo}).`);
  }
  if (cerrar) {
    const faltan = [];
    if (valores.votantes === null) faltan.push('total de votantes');
    for (const [id, v] of valores.votos) if (v === null) faltan.push(etiquetas.get(id) ?? `candidatura ${id}`);
    if (valores.blancos === null) faltan.push('blancos');
    if (valores.nulos === null) faltan.push('nulos');
    if (faltan.length > 0) {
      const lista = faltan.length > 6 ? `${faltan.slice(0, 6).join(', ')} y ${faltan.length - 6} más` : faltan.join(', ');
      errores.push(`Para cerrar la mesa hay que rellenar todo (0 incluido). Faltan: ${lista}.`);
    } else if (suma !== valores.votantes) {
      const dif = suma - valores.votantes;
      errores.push(
        `La suma de candidaturas, blancos y nulos (${suma}) no coincide con el total de votantes (${valores.votantes}): ${dif > 0 ? 'sobran' : 'faltan'} ${Math.abs(dif)}.`
      );
    }
  }
  if (valores.votantes !== null && ultimaPart && valores.votantes !== ultimaPart.valor) {
    avisos.push(`El total de votantes (${valores.votantes}) difiere de la última participación informada (${ultimaPart.valor}, de las ${ultimaPart.hora}).`);
  }
  return { errores, avisos, suma };
}

// ---------- Resumen ----------
const redondear2 = (x) => Math.round(x * 100) / 100;
export const porcentaje2 = (votos, validos) => (validos > 0 ? redondear2((votos * 100) / validos) : null);
export const formatoPorcentaje2 = (p) => (p === null ? VACIO : `${p.toFixed(2).replace('.', ',')} %`);

// mesas: activas [{id, codigo, censo}]; candidaturas: las del Congreso [{id, nombre, siglas, orden, destacada, activa, color, logo_hash}]
// ordenadas por orden; recuentos: Map mesaId -> { cab, votos: Map }.
// SOLO las mesas CERRADAS suman en los totales; los borradores no. % sobre votos válidos (candidaturas + blancos).
export function construirResumenRecuento({ mesas, candidaturas, recuentos }) {
  const filasMesa = mesas.map((mesa) => {
    const r = recuentos.get(mesa.id) ?? null;
    return { mesa, cab: r?.cab ?? null, votos: r?.votos ?? new Map(), estado: !r?.cab ? 'sin_iniciar' : r.cab.estado };
  });
  const cerradas = filasMesa.filter((f) => f.estado === 'cerrado');
  const sumaCerradas = (valorDe) => cerradas.reduce((a, f) => a + (valorDe(f) ?? 0), 0);

  const todas = candidaturas.map((cand) => ({ cand, votos: sumaCerradas((f) => f.votos.get(cand.id)) }));
  // Se listan las activas y, si hubiera votos, también las inactivas.
  const lista = todas.filter((c) => c.cand.activa || c.votos > 0);
  const blancos = sumaCerradas((f) => f.cab?.votos_blancos);
  const nulos = sumaCerradas((f) => f.cab?.votos_nulos);
  const votantes = sumaCerradas((f) => f.cab?.votantes);
  const validos = lista.reduce((a, c) => a + c.votos, 0) + blancos;
  const conPct = lista.map((c) => ({ ...c, porcentaje: porcentaje2(c.votos, validos) }));

  const hayDestacadas = conPct.some((c) => c.cand.destacada);
  const destacadas = hayDestacadas ? conPct.filter((c) => c.cand.destacada) : conPct;
  const resto = hayDestacadas ? conPct.filter((c) => !c.cand.destacada) : [];
  const votosOtros = resto.reduce((a, c) => a + c.votos, 0);

  return {
    mesas: filasMesa,
    totalMesas: mesas.length,
    cerradas: cerradas.length,
    borradores: filasMesa.filter((f) => f.estado === 'borrador').length,
    sinIniciar: filasMesa.filter((f) => f.estado === 'sin_iniciar').length,
    provisional: cerradas.length < mesas.length,
    candidaturas: conPct,
    destacadas,
    otros: resto.length > 0 ? { cantidad: resto.length, votos: votosOtros, porcentaje: porcentaje2(votosOtros, validos), candidaturas: resto } : null,
    blancos,
    nulos,
    votantes,
    validos,
    porcentajeBlancos: porcentaje2(blancos, validos),
  };
}

const MARCA_DEMO = '*** DEMO - DATOS DE PRUEBA, NO SON REALES ***';

// Texto plano para WhatsApp (admite *negrita*). `actualizado`: 'DD/MM/AAAA HH:MM:SS'.
export function textoRecuento({ resumen, colegio, modo, actualizado, tipoEleccion }) {
  const l = [];
  if (modo === 'DEMO') l.push(MARCA_DEMO, '');
  l.push(`*${colegio} · ${tipoEleccion}*`);
  const estado = resumen.provisional ? 'PROVISIONAL' : 'COMPLETO';
  l.push(`Recuento ${ELECCION_TEXTO} — ${estado} (${resumen.cerradas}/${resumen.totalMesas} mesas escrutadas)`);
  if (resumen.cerradas === 0) {
    l.push('Todavía no hay mesas escrutadas.');
  } else {
    for (const c of resumen.destacadas) l.push(`${c.cand.siglas || c.cand.nombre}: ${c.votos} (${formatoPorcentaje2(c.porcentaje)})`);
    if (resumen.otros) l.push(`Otros: ${resumen.otros.votos} (${formatoPorcentaje2(resumen.otros.porcentaje)})`);
    l.push(`Blancos: ${resumen.blancos} (${formatoPorcentaje2(resumen.porcentajeBlancos)})`);
    l.push(`Nulos: ${resumen.nulos}`);
    l.push(`*Total de votantes: ${resumen.votantes}*`);
    l.push('(% sobre votos válidos: candidaturas + blancos)');
  }
  l.push(`Actualizado: ${actualizado} (hora de Madrid)`);
  if (modo === 'DEMO') l.push('', MARCA_DEMO);
  return l.join('\n');
}
