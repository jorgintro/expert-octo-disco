// Orquesta el recuento de una mesa: permisos, validaciones, confirmación de cierre y control de versión.
// Lee la configuración (mesa, candidaturas, cortes) de app.db y delega la escritura en `captura`, que ya viene
// atada al destino del modo (DEMO -> demo.db, REAL -> app.db). Sin SQL sobre tablas de captura.
import { listarCandidaturas } from './candidaturas.js';
import { ConflictoVersionError } from './captura.js';
import { leerEntrada, ultimaParticipacion, validarRecuento } from './recuento.js';
import { recuentoAbierto } from './recuentoEstado.js';
import { listarCortes } from './servicioParticipacion.js';

export const MENSAJE_RECUENTO_CERRADO = 'El recuento no está abierto.';
export const MENSAJE_MESA_CERRADA =
  'Esta mesa está cerrada y ya no se puede editar. Si hay que corregirla, díselo al Jefe de Colegio: puede reabrirla.';
export const MENSAJE_ADMIN =
  'Los datos de esta mesa los introdujo el administrador y solo él puede modificarlos. Si algo es incorrecto, díselo al Jefe de Colegio.';
export const MENSAJE_CONFLICTO =
  'Esta mesa ha sido modificada desde otro dispositivo. Recarga para ver lo último guardado, o mantén lo tuyo y sobrescribe.';

// Todo lo necesario para pintar el formulario de una mesa.
export function cargarMesaRecuento(db, captura, mesaId) {
  const mesa = db.prepare('SELECT * FROM mesa WHERE id = ?').get(mesaId);
  if (!mesa) return null;
  const { cab, votos } = captura.obtenerRecuento(mesaId);
  // Las activas, y las inactivas solo si esta mesa ya tiene votos suyos (para no esconder datos).
  const candidaturas = listarCandidaturas(db).filter((c) => c.activa || votos.has(c.id));
  const ultima = ultimaParticipacion(captura.listarParticipacion(mesaId), listarCortes(db));
  return { mesa, candidaturas, cab, votos, ultima };
}

export const etiquetasDe = (candidaturas) => new Map(candidaturas.map((c) => [c.id, c.siglas || c.nombre]));

// Un agente solo puede tocar el recuento si está abierto, la mesa no está cerrada y no la introdujo el administrador.
export function comprobarAcceso({ db, actor, cab, modo }) {
  if (actor.tipo === 'admin') return null; // el administrador puede siempre (plan B)
  if (!recuentoAbierto(db, modo)) return { estado: 'recuento_cerrado', mensaje: MENSAJE_RECUENTO_CERRADO };
  if (cab?.estado === 'cerrado') return { estado: 'mesa_cerrada', mensaje: MENSAJE_MESA_CERRADA };
  if (cab?.introducido_por_tipo === 'admin') return { estado: 'bloqueado', mensaje: MENSAJE_ADMIN };
  return null;
}

// entrada: { votantes, blancos, nulos, votos: { [candidaturaId]: texto } } (texto crudo del formulario).
// Resultados: 'guardado' | 'cerrado' | 'error' | 'confirmar' | 'conflicto' | 'recuento_cerrado' | 'mesa_cerrada' |
//             'bloqueado' | 'no_encontrado'
export function guardarRecuentoMesa({ db, captura, actor, mesaId, entrada, version, cerrar = false, confirmar = false, automatico = false, modo }) {
  const datos = cargarMesaRecuento(db, captura, mesaId);
  if (!datos) return { estado: 'no_encontrado' };
  const acceso = comprobarAcceso({ db, actor, cab: datos.cab, modo });
  if (acceso) return acceso;

  const etiquetas = etiquetasDe(datos.candidaturas);
  const { valores, errores: erroresFormato } = leerEntrada(entrada, datos.candidaturas.map((c) => c.id), etiquetas);
  if (erroresFormato.length > 0) return { estado: 'error', errores: erroresFormato, valores };

  // Editar una mesa ya cerrada (solo el administrador) se valida como un cierre: tiene que seguir cuadrando.
  const estabaCerrada = datos.cab?.estado === 'cerrado';
  const { errores, avisos, suma } = validarRecuento({ valores, censo: datos.mesa.censo, etiquetas, cerrar: cerrar || estabaCerrada, ultimaPart: datos.ultima });
  if (errores.length > 0) return { estado: 'error', errores, valores, suma };

  // Cerrar siempre pide confirmación (los avisos, p. ej. que difiere de la última participación, van ahí).
  if (cerrar && !confirmar) return { estado: 'confirmar', avisos, valores, suma, version };

  try {
    const r = captura.guardarRecuento({
      mesaId, valores: { votantes: valores.votantes, blancos: valores.blancos, nulos: valores.nulos, votos: valores.votos },
      estado: cerrar ? 'cerrado' : (datos.cab?.estado ?? 'borrador'), versionEsperada: version, actor, automatico,
    });
    return { estado: cerrar ? 'cerrado' : 'guardado', version: r.version, actualizadoEn: r.actualizadoEn, cambiado: r.cambiado, avisos, suma };
  } catch (e) {
    if (e instanceof ConflictoVersionError) return { estado: 'conflicto', versionActual: e.versionActual, mensaje: MENSAJE_CONFLICTO };
    throw e;
  }
}

// Solo el administrador reabre una mesa cerrada.
export function reabrirRecuentoMesa({ db, captura, actor, mesaId, version }) {
  if (actor.tipo !== 'admin') throw new Error('Solo el administrador puede reabrir una mesa');
  if (!cargarMesaRecuento(db, captura, mesaId)) return { estado: 'no_encontrado' };
  try {
    const r = captura.reabrirRecuento({ mesaId, versionEsperada: version, actor });
    return { estado: r.cambiado ? 'reabierta' : 'sin_cambios', version: r.version };
  } catch (e) {
    if (e instanceof ConflictoVersionError) return { estado: 'conflicto', versionActual: e.versionActual, mensaje: MENSAJE_CONFLICTO };
    throw e;
  }
}
