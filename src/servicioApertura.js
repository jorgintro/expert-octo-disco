// Apertura y cierre del recuento (a mano; el reloj nunca lo bloquea). En REAL, para abrirlo hace falta que todas
// las mesas activas tengan la participación informada en el último corte; en DEMO no hay requisito.
import { auditar } from './auditoria.js';
import { listarCandidaturas } from './candidaturas.js';
import { fijarAbierto, recuentoAbierto } from './recuentoEstado.js';
import { listarCortes } from './servicioParticipacion.js';
import { horaMadrid } from './tiempo.js';

export const HORA_CIERRE_COLEGIOS = '20:00';

export function comprobarApertura({ db, captura, modo, ahora }) {
  const motivos = [];
  const avisos = [];
  const activas = listarCandidaturas(db).filter((c) => c.activa);
  if (activas.length === 0) motivos.push('No hay candidaturas activas: carga las candidaturas antes de abrir el recuento.');

  let pendientes = [];
  if (modo === 'REAL') {
    const cortes = listarCortes(db);
    const ultimo = cortes.at(-1);
    const informadas = new Set(captura.listarParticipacion().filter((f) => f.corte_id === ultimo?.id).map((f) => f.mesa_id));
    pendientes = db
      .prepare('SELECT id, codigo FROM mesa WHERE activa = 1 ORDER BY CAST(distrito AS INTEGER), CAST(seccion AS INTEGER), letra')
      .all()
      .filter((m) => !informadas.has(m.id));
    if (pendientes.length > 0) {
      motivos.push(
        `Falta la participación del corte de las ${ultimo?.hora ?? '—'} de ${pendientes.length === 1 ? 'la mesa' : 'las mesas'} ${pendientes.map((m) => m.codigo).join(', ')}. Hasta que estén todas informadas no se puede abrir el recuento (el administrador puede introducirla desde «Participación»).`
      );
    }
    const hora = horaMadrid(ahora);
    if (hora < HORA_CIERRE_COLEGIOS) avisos.push(`Son las ${hora}: los colegios cierran a las ${HORA_CIERRE_COLEGIOS}. Abrir el recuento antes de esa hora no está impedido, pero es muy pronto.`);
  }
  return { ok: motivos.length === 0, motivos, avisos, pendientes };
}

export function abrirRecuento(db, modo, actor) {
  if (recuentoAbierto(db, modo)) return false;
  db.transaction(() => {
    fijarAbierto(db, modo, true);
    auditar(db, actor, 'abrir_recuento', 'ajuste', null, { abierto: false, modo }, { abierto: true, modo });
  })();
  return true;
}

export function cerrarRecuento(db, modo, actor) {
  if (!recuentoAbierto(db, modo)) return false;
  db.transaction(() => {
    fijarAbierto(db, modo, false);
    auditar(db, actor, 'cerrar_recuento', 'ajuste', null, { abierto: true, modo }, { abierto: false, modo });
  })();
  return true;
}
