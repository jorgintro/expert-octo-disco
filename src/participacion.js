// Reglas de la participación acumulada (SPEC §6). Funciones puras, sin acceso a datos.

export const UMBRAL_SALTO_PORCENTAJE = 25;

// Interpreta lo escrito en el campo: solo cifras (entero >= 0).
export function leerNumero(texto) {
  const t = String(texto ?? '').trim();
  if (t === '') return { ok: false, error: 'Escribe el número de votantes acumulado.' };
  if (!/^\d+$/.test(t)) return { ok: false, error: 'Escribe solo cifras: un número entero, sin decimales, signos ni letras.' };
  if (t.length > 7) return { ok: false, error: 'El número es demasiado grande.' };
  return { ok: true, valor: Number(t) };
}

// cortes: [{id, hora, orden}] ordenados por `orden`. valores: Map corteId -> acumulado ya introducido.
// Devuelve errores (bloquean), avisos (piden confirmación) y el parcial del tramo.
export function validarParticipacion({ valor, censo, cortes, corteId, valores }) {
  const errores = [];
  const avisos = [];
  const indice = cortes.findIndex((c) => c.id === corteId);

  let anterior = null;
  for (let i = indice - 1; i >= 0; i--) {
    if (valores.has(cortes[i].id)) {
      anterior = { hora: cortes[i].hora, valor: valores.get(cortes[i].id) };
      break;
    }
  }
  let siguiente = null;
  for (let i = indice + 1; i < cortes.length; i++) {
    if (valores.has(cortes[i].id)) {
      siguiente = { hora: cortes[i].hora, valor: valores.get(cortes[i].id) };
      break;
    }
  }

  if (valor > censo) errores.push(`No puede superar el censo de la mesa (${censo}).`);
  if (anterior && valor < anterior.valor) {
    errores.push(`No puede ser menor que el acumulado de las ${anterior.hora} (${anterior.valor}).`);
  }
  if (siguiente && valor > siguiente.valor) {
    errores.push(`No puede ser mayor que el acumulado de las ${siguiente.hora} (${siguiente.valor}).`);
  }

  const parcial = valor - (anterior?.valor ?? 0);
  if (errores.length === 0 && censo > 0 && parcial * 100 > censo * UMBRAL_SALTO_PORCENTAJE) {
    avisos.push(
      `Salto de ${parcial} votantes en este tramo: más del ${UMBRAL_SALTO_PORCENTAJE} % del censo (${censo}).`
    );
  }
  return { errores, avisos, parcial, anterior, siguiente };
}

// Corte "actual": el más reciente cuya hora ya pasó; el primero si aún no ha llegado ninguno.
export function corteActual(cortes, horaActual) {
  const pasados = cortes.filter((c) => c.hora <= horaActual);
  return pasados.length > 0 ? pasados[pasados.length - 1] : cortes[0];
}

export const corteHaLlegado = (corte, horaActual) => corte.hora <= horaActual;

// Porcentaje sobre censo con un decimal (o null si el censo es 0).
export const porcentajeSobreCenso = (acumulado, censo) => (censo > 0 ? Math.round((acumulado * 1000) / censo) / 10 : null);

// Marcador de «sin dato» (en las tablas se pinta en gris y sin enlace subrayado).
export const VACIO = '–';

export const formatoPorcentaje = (p) => (p === null ? VACIO : `${String(p.toFixed(1)).replace('.', ',')} %`);

// Histórico de una mesa: una fila por corte con acumulado, parcial (respecto al último corte anterior
// ya introducido, o 0) y % sobre censo.
export function construirHistorial({ cortes, filas, censo }) {
  const porCorte = new Map(filas.map((f) => [f.corte_id, f]));
  let anterior = 0;
  return cortes.map((corte) => {
    const f = porCorte.get(corte.id);
    if (!f) return { corte, vacio: true };
    const fila = {
      corte,
      vacio: false,
      acumulado: f.votantes_acumulados,
      parcial: f.votantes_acumulados - anterior,
      porcentaje: porcentajeSobreCenso(f.votantes_acumulados, censo),
      tipo: f.introducido_por_tipo,
      porId: f.introducido_por_id,
      actualizadoEn: f.actualizado_en,
    };
    anterior = f.votantes_acumulados;
    return fila;
  });
}
