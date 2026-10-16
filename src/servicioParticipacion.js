// Orquesta el guardado de la participación: permisos, validaciones y confirmaciones. Lee la
// configuración (mesa, corte) de app.db y delega la escritura en `captura`, que ya viene atada al
// destino del modo (DEMO -> demo.db, REAL -> app.db). No contiene SQL sobre tablas de captura.
import { REAL } from './modo.js';
import { corteHaLlegado, leerNumero, validarParticipacion } from './participacion.js';
import { horaMadrid } from './tiempo.js';

export const MENSAJE_BLOQUEADO =
  'Este dato lo introdujo el administrador y solo él puede modificarlo. Si es incorrecto, díselo al Jefe de Colegio.';

export const listarCortes = (db) => db.prepare('SELECT id, hora, orden FROM corte ORDER BY orden').all();

// Datos de una mesa: censo, cortes y lo ya capturado (en el destino del modo).
export function datosDeMesa(db, captura, mesaId) {
  const mesa = db.prepare('SELECT * FROM mesa WHERE id = ?').get(mesaId);
  if (!mesa) return null;
  return { mesa, cortes: listarCortes(db), filas: captura.listarParticipacion(mesaId) };
}

// Resultados: 'guardado' | 'sin_cambios' | 'error' | 'confirmar' | 'bloqueado' | 'no_encontrado'
export function guardarDato({ db, captura, actor, mesaId, corteId, texto, confirmar = false, ahora, modo }) {
  const datos = datosDeMesa(db, captura, mesaId);
  const corte = datos?.cortes.find((c) => c.id === corteId);
  if (!datos || !corte) return { estado: 'no_encontrado' };

  const previa = datos.filas.find((f) => f.corte_id === corteId);
  if (actor.tipo === 'agente' && previa?.introducido_por_tipo === 'admin') {
    return { estado: 'bloqueado', mensaje: MENSAJE_BLOQUEADO };
  }

  const numero = leerNumero(texto);
  if (!numero.ok) return { estado: 'error', errores: [numero.error] };

  const valores = new Map(datos.filas.filter((f) => f.corte_id !== corteId).map((f) => [f.corte_id, f.votantes_acumulados]));
  const { errores, avisos, parcial } = validarParticipacion({
    valor: numero.valor,
    censo: datos.mesa.censo,
    cortes: datos.cortes,
    corteId,
    valores,
  });
  if (errores.length > 0) return { estado: 'error', errores };

  // En REAL, guardar un corte que aún no ha llegado pide confirmación; en DEMO no.
  const horaActual = horaMadrid(ahora);
  if (modo === REAL && !corteHaLlegado(corte, horaActual)) {
    avisos.push(`El corte de las ${corte.hora} aún no ha llegado (ahora son las ${horaActual}).`);
  }
  if (avisos.length > 0 && !confirmar) return { estado: 'confirmar', avisos, valor: numero.valor, parcial };

  const r = captura.guardarParticipacion({ mesaId, corteId, votantes: numero.valor, actor });
  return { estado: r.cambiado ? 'guardado' : 'sin_cambios', valor: numero.valor, parcial };
}

// Solo el administrador puede vaciar una celda.
export function vaciarDato({ db, captura, actor, mesaId, corteId }) {
  if (actor.tipo !== 'admin') throw new Error('Solo el administrador puede vaciar un dato');
  const datos = datosDeMesa(db, captura, mesaId);
  if (!datos || !datos.cortes.some((c) => c.id === corteId)) return { estado: 'no_encontrado' };
  return { estado: captura.eliminarParticipacion({ mesaId, corteId, actor }) ? 'vaciado' : 'sin_cambios' };
}
