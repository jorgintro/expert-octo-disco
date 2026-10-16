// Orquesta el recuento del Senado de una mesa: permisos, modo, validaciones, confirmación de cierre y control de
// versión; y la apertura/cierre del Senado. Lee la configuración (mesa, candidatos, cortes) de app.db y delega la
// escritura en `captura`, atada al destino del modo (DEMO -> demo.db, REAL -> app.db). Sin SQL sobre captura.
import { auditar } from './auditoria.js';
import { ConflictoVersionError, ModoSenadoError } from './captura.js';
import { listarCandidatos } from './candidatosSenado.js';
import { ultimaParticipacion } from './recuento.js';
import { fijarSenadoAbierto, senadoAbierto } from './recuentoEstado.js';
import { HORA_CIERRE_COLEGIOS } from './servicioApertura.js';
import { agruparEnListas, leerEntradaSenado, validarSenado } from './senado.js';
import { listarCortes } from './servicioParticipacion.js';
import { horaMadrid } from './tiempo.js';

export const MENSAJE_SENADO_CERRADO = 'El recuento del Senado no está abierto.';
export const MENSAJE_MESA_CERRADA =
  'Esta mesa está cerrada y ya no se puede editar. Si hay que corregirla, díselo al Jefe de Colegio: puede reabrirla.';
export const MENSAJE_ADMIN =
  'Los datos del Senado de esta mesa los introdujo el administrador y solo él puede modificarlos. Si algo es incorrecto, díselo al Jefe de Colegio.';
export const MENSAJE_CONFLICTO =
  'Esta mesa ha sido modificada desde otro dispositivo.';
export const mensajeModo = (modoActual) =>
  `Esta mesa ya se está contando en modo «${modoActual === 'sabana' ? 'sábana a sábana' : 'totales'}». Solo el administrador puede reiniciar el recuento del Senado de la mesa para cambiar de modo.`;

// Todo lo necesario para pintar el recuento del Senado de una mesa.
export function cargarMesaSenado(db, captura, mesaId) {
  const mesa = db.prepare('SELECT * FROM mesa WHERE id = ?').get(mesaId);
  if (!mesa) return null;
  const { cab, votos, matriz } = captura.obtenerSenado(mesaId);
  // Los activos, y los inactivos solo si esta mesa ya tiene votos suyos (para no esconder datos).
  const candidatos = listarCandidatos(db).filter((c) => c.activo || votos.has(c.id));
  const ultima = ultimaParticipacion(captura.listarParticipacion(mesaId), listarCortes(db));
  const votantesCongreso = captura.obtenerRecuento(mesaId).cab?.votantes ?? null;
  return { mesa, candidatos, listas: agruparEnListas(candidatos), cab, votos, matriz, ultima, votantesCongreso };
}

export const etiquetasDe = (candidatos) => new Map(candidatos.map((c) => [c.id, c.nombre]));

// Contadores en el formato del navegador (también para la respuesta de conflicto).
export function contadoresDeDatos({ candidatos, votos, matriz, cab }) {
  return {
    version: cab?.version ?? 0,
    votos: Object.fromEntries(candidatos.map((c) => [c.id, votos.get(c.id) ?? 0])),
    matriz: Object.fromEntries(['1:1', '2:0', '2:1', '3:0', '3:1'].map((k) => [k, matriz.get(k) ?? 0])),
    blancas: cab?.blancas ?? 0,
    nulas: cab?.nulas ?? 0,
  };
}

// Un agente solo puede tocar el Senado si está abierto, la mesa no está cerrada y no la introdujo el administrador.
export function comprobarAccesoSenado({ db, actor, cab, modo }) {
  if (actor.tipo === 'admin') return null; // el administrador puede siempre (plan B)
  if (!senadoAbierto(db, modo)) return { estado: 'senado_cerrado', mensaje: MENSAJE_SENADO_CERRADO };
  if (cab?.estado === 'cerrado') return { estado: 'mesa_cerrada', mensaje: MENSAJE_MESA_CERRADA };
  if (cab?.introducido_por_tipo === 'admin') return { estado: 'bloqueado', mensaje: MENSAJE_ADMIN };
  return null;
}

// entrada: texto crudo del formulario (ver entradaSenado.js).
// Resultados: 'guardado' | 'cerrado' | 'error' | 'confirmar' | 'conflicto' | 'modo_distinto' | 'senado_cerrado' |
//             'mesa_cerrada' | 'bloqueado' | 'sin_datos' | 'no_encontrado'
export function guardarSenadoMesa({ db, captura, actor, mesaId, entrada, version, cerrar = false, confirmar = false, automatico = false, modo }) {
  const datos = cargarMesaSenado(db, captura, mesaId);
  if (!datos) return { estado: 'no_encontrado' };
  const acceso = comprobarAccesoSenado({ db, actor, cab: datos.cab, modo });
  if (acceso) return acceso;
  if (datos.cab && entrada.modo !== datos.cab.modo) return { estado: 'modo_distinto', modoActual: datos.cab.modo, mensaje: mensajeModo(datos.cab.modo) };

  const etiquetas = etiquetasDe(datos.candidatos);
  const { valores, errores: erroresFormato } = leerEntradaSenado(entrada, datos.candidatos.map((c) => c.id), etiquetas);
  if (erroresFormato.length > 0) return { estado: 'error', errores: erroresFormato, valores };

  // Editar una mesa ya cerrada (solo el administrador) se valida como un cierre: tiene que seguir cuadrando.
  const estabaCerrada = datos.cab?.estado === 'cerrado';
  const { errores, avisos, suma, contadas } = validarSenado({
    valores, censo: datos.mesa.censo, etiquetas, cerrar: cerrar || estabaCerrada, listas: datos.listas,
    votantesCongreso: datos.votantesCongreso, ultimaPart: datos.ultima,
  });
  if (errores.length > 0) return { estado: 'error', errores, valores, suma };

  // El primer dato fija el modo: sin nada que guardar, no se crea la mesa (ni se fija el modo).
  if (!datos.cab && !cerrar && ![...valores.votos.values(), valores.validas, valores.blancas, valores.nulas].some((v) => v !== null && v !== 0)) {
    return { estado: 'sin_datos', version: 0 };
  }

  // Cerrar siempre pide confirmación (los avisos, p. ej. que difiere del Congreso, van ahí).
  if (cerrar && !confirmar) return { estado: 'confirmar', avisos, valores, suma, contadas, version };

  try {
    const r = captura.guardarSenado({
      mesaId, valores, estado: cerrar ? 'cerrado' : (datos.cab?.estado ?? 'borrador'), versionEsperada: version, actor, automatico,
    });
    return { estado: cerrar ? 'cerrado' : 'guardado', version: r.version, actualizadoEn: r.actualizadoEn, cambiado: r.cambiado, avisos, suma, contadas };
  } catch (e) {
    if (e instanceof ConflictoVersionError) {
      const actual = cargarMesaSenado(db, captura, mesaId);
      return { estado: 'conflicto', versionActual: e.versionActual, mensaje: MENSAJE_CONFLICTO, contadores: contadoresDeDatos(actual) };
    }
    if (e instanceof ModoSenadoError) return { estado: 'modo_distinto', modoActual: e.modoActual, mensaje: mensajeModo(e.modoActual) };
    throw e;
  }
}

// Solo el administrador reabre una mesa cerrada.
export function reabrirSenadoMesa({ db, captura, actor, mesaId, version }) {
  if (actor.tipo !== 'admin') throw new Error('Solo el administrador puede reabrir una mesa');
  if (!cargarMesaSenado(db, captura, mesaId)) return { estado: 'no_encontrado' };
  try {
    const r = captura.reabrirSenado({ mesaId, versionEsperada: version, actor });
    return { estado: r.cambiado ? 'reabierta' : 'sin_cambios', version: r.version };
  } catch (e) {
    if (e instanceof ConflictoVersionError) return { estado: 'conflicto', versionActual: e.versionActual, mensaje: MENSAJE_CONFLICTO };
    throw e;
  }
}

// Solo el administrador reinicia el Senado de una mesa (para cambiar de modo). La ruta pide confirmación.
export function reiniciarSenadoMesa({ db, captura, actor, mesaId, version }) {
  if (actor.tipo !== 'admin') throw new Error('Solo el administrador puede reiniciar el recuento del Senado de una mesa');
  if (!cargarMesaSenado(db, captura, mesaId)) return { estado: 'no_encontrado' };
  try {
    const r = captura.reiniciarSenado({ mesaId, versionEsperada: version, actor });
    return { estado: r.cambiado ? 'reiniciada' : 'sin_cambios' };
  } catch (e) {
    if (e instanceof ConflictoVersionError) return { estado: 'conflicto', versionActual: e.versionActual, mensaje: MENSAJE_CONFLICTO };
    throw e;
  }
}

// ---------- Apertura y cierre del Senado (a mano; independiente del Congreso; el reloj nunca lo bloquea) ----------
export function comprobarAperturaSenado({ db, modo, ahora }) {
  const motivos = [];
  const avisos = [];
  if (listarCandidatos(db).filter((c) => c.activo).length === 0) motivos.push('No hay candidatos del Senado activos: carga los candidatos antes de abrir el recuento.');
  if (modo === 'REAL') {
    const hora = horaMadrid(ahora);
    if (hora < HORA_CIERRE_COLEGIOS) avisos.push(`Son las ${hora}: los colegios cierran a las ${HORA_CIERRE_COLEGIOS}. Abrir el recuento antes de esa hora no está impedido, pero es muy pronto.`);
  }
  return { ok: motivos.length === 0, motivos, avisos };
}

export function abrirSenado(db, modo, actor) {
  if (senadoAbierto(db, modo)) return false;
  db.transaction(() => {
    fijarSenadoAbierto(db, modo, true);
    auditar(db, actor, 'abrir_senado', 'ajuste', null, { abierto: false, modo }, { abierto: true, modo });
  })();
  return true;
}

export function cerrarSenado(db, modo, actor) {
  if (!senadoAbierto(db, modo)) return false;
  db.transaction(() => {
    fijarSenadoAbierto(db, modo, false);
    auditar(db, actor, 'cerrar_senado', 'ajuste', null, { abierto: true, modo }, { abierto: false, modo });
  })();
  return true;
}
