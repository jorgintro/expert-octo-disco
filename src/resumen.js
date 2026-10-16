// Resumen de participación del colegio: tabla mesa x corte, totales, mesas pendientes y texto para
// WhatsApp. Funciones puras (sin acceso a datos ni al reloj).
import { VACIO, construirHistorial, formatoPorcentaje, porcentajeSobreCenso } from './participacion.js';

export const TIPO_ELECCION = 'Elecciones Generales';

// Variantes de la vista /pantallazo.
export const VARIANTES = [
  { id: 'participacion', etiqueta: 'Participación', disponible: true },
  { id: 'ultimo', etiqueta: 'Último corte', disponible: true },
  { id: 'recuento', etiqueta: 'Recuento', disponible: true },
  { id: 'senado', etiqueta: 'Senado', disponible: true },
];
export const VARIANTE_POR_DEFECTO = 'participacion';

export function elegirVariante(id) {
  return VARIANTES.find((v) => v.id === id && v.disponible) ?? VARIANTES.find((v) => v.id === VARIANTE_POR_DEFECTO);
}

// mesas: solo las ACTIVAS [{id, codigo, censo}]; cortes: [{id, hora}] en orden; filas: participación.
// Total del colegio en un corte: suma de lo informado; su % es sobre el censo de las mesas informadas
// en ese corte (con 4/6 mesas, dividir entre el censo de las 6 daría una participación artificialmente baja).
export function construirResumen({ mesas, cortes, filas }) {
  const porMesa = new Map();
  for (const f of filas) {
    if (!porMesa.has(f.mesa_id)) porMesa.set(f.mesa_id, []);
    porMesa.get(f.mesa_id).push(f);
  }
  const filasMesa = mesas.map((mesa) => ({
    mesa,
    historial: construirHistorial({ cortes, filas: porMesa.get(mesa.id) ?? [], censo: mesa.censo }),
  }));

  const totales = cortes.map((corte, i) => {
    const t = { corte, informadas: 0, total: mesas.length, acumulado: 0, parcial: 0, censoInformado: 0 };
    for (const { mesa, historial } of filasMesa) {
      const celda = historial[i];
      if (celda.vacio) continue;
      t.informadas++;
      t.acumulado += celda.acumulado;
      t.parcial += celda.parcial;
      t.censoInformado += mesa.censo;
    }
    return {
      ...t,
      faltan: t.total - t.informadas,
      porcentaje: porcentajeSobreCenso(t.acumulado, t.censoInformado),
    };
  });

  let indiceUltimo = -1;
  totales.forEach((t, i) => {
    if (t.informadas > 0) indiceUltimo = i;
  });
  const completo = indiceUltimo >= 0 && totales[indiceUltimo].faltan === 0;
  return {
    cortes,
    mesas: filasMesa,
    totales,
    indiceUltimo,
    // Provisional mientras el último corte con datos no tenga todas las mesas.
    provisional: !completo,
    pendientesUltimo:
      indiceUltimo >= 0 ? filasMesa.filter((f) => f.historial[indiceUltimo].vacio).map((f) => f.mesa.codigo) : mesas.map((m) => m.codigo),
    indicesConDatos: totales.map((t, i) => (t.informadas > 0 ? i : -1)).filter((i) => i >= 0),
    totalMesas: mesas.length,
  };
}

const MARCA_DEMO = '*** DEMO - DATOS DE PRUEBA, NO SON REALES ***';

// Resumen en texto plano para pegar en WhatsApp (admite *negrita*). `actualizado`: 'DD/MM/AAAA HH:MM:SS'.
export function textoWhatsApp({ resumen, variante, colegio, modo, actualizado }) {
  const lineas = [];
  if (modo === 'DEMO') lineas.push(MARCA_DEMO, '');
  lineas.push(`*${colegio} · ${TIPO_ELECCION}*`);

  if (resumen.indiceUltimo < 0) {
    lineas.push('Todavía no hay datos de participación.');
  } else if (variante === 'ultimo') {
    const i = resumen.indiceUltimo;
    const t = resumen.totales[i];
    const estado = resumen.provisional ? `PROVISIONAL (${t.informadas}/${t.total} mesas)` : `COMPLETO (${t.informadas}/${t.total} mesas)`;
    lineas.push(`Participación a las ${t.corte.hora} — ${estado}`);
    for (const { mesa, historial } of resumen.mesas) {
      const c = historial[i];
      lineas.push(c.vacio ? `${mesa.codigo}: sin dato` : `${mesa.codigo}: ${c.acumulado} (+${c.parcial}) · ${formatoPorcentaje(c.porcentaje)}`);
    }
    lineas.push(`*TOTAL: ${t.acumulado} (+${t.parcial}) · ${formatoPorcentaje(t.porcentaje)}*`);
  } else {
    const idx = resumen.indicesConDatos;
    const ultimo = resumen.totales[resumen.indiceUltimo];
    const estado = resumen.provisional ? `PROVISIONAL (${ultimo.informadas}/${ultimo.total} mesas)` : `COMPLETO (${ultimo.informadas}/${ultimo.total} mesas)`;
    lineas.push(`Participación acumulada — ${estado}`);
    lineas.push(`Cortes: ${idx.map((i) => resumen.totales[i].corte.hora).join(' → ')}`);
    for (const { mesa, historial } of resumen.mesas) {
      const celdas = idx.map((i) => historial[i]);
      const ultimaConDato = [...celdas].reverse().find((c) => !c.vacio);
      lineas.push(
        ultimaConDato
          ? `${mesa.codigo}: ${celdas.map((c) => (c.vacio ? VACIO : c.acumulado)).join(' → ')} · ${formatoPorcentaje(ultimaConDato.porcentaje)}`
          : `${mesa.codigo}: sin datos`
      );
    }
    // El total de cada corte suma solo las mesas informadas en él: se indica cuántas son.
    lineas.push('*TOTAL por corte:*');
    for (const i of idx) {
      const t = resumen.totales[i];
      lineas.push(`${t.corte.hora}: ${t.acumulado} (${t.informadas}/${t.total} mesas) · ${formatoPorcentaje(t.porcentaje)}`);
    }
  }
  if (resumen.indiceUltimo >= 0 && resumen.provisional) {
    lineas.push('(% del total sobre el censo de las mesas informadas)');
  }
  lineas.push(`Actualizado: ${actualizado} (hora de Madrid)`);
  if (modo === 'DEMO') lineas.push('', MARCA_DEMO);
  return lineas.join('\n');
}
