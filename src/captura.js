// ÚNICA capa con SQL sobre las tablas de captura (participación; recuento llegará en la 0.5).
// Las rutas nunca reciben una conexión: reciben un objeto `Captura` que el gestor de datos ya ha
// atado al destino correcto según el modo (DEMO -> demo.db, REAL -> app.db). Así, en DEMO no existe
// ningún camino de código hacia las tablas de captura reales.
import path from 'node:path';
import { accionesDistintas, auditar, contarAuditoria, listarAuditoria } from './auditoria.js';

export const NOMBRE_DEMO = 'demo.db';

export class ModoCambiadoError extends Error {
  constructor() {
    super('El modo de trabajo ha cambiado mientras se atendía la petición. Recarga la página.');
    this.name = 'ModoCambiadoError';
  }
}

export class Captura {
  #gestor;
  #db;
  #generacion;

  constructor(gestor, destino, db, generacion) {
    if (destino !== 'demo' && destino !== 'real') throw new Error(`Destino de captura desconocido: ${destino}`);
    const esFicheroDemo = path.basename(db.name) === NOMBRE_DEMO;
    if (destino === 'demo' && !esFicheroDemo) throw new Error('La captura DEMO solo puede abrir demo.db');
    if (destino === 'real' && esFicheroDemo) throw new Error('La captura REAL no puede usar demo.db');
    this.#gestor = gestor;
    this.#db = db;
    this.#generacion = generacion;
    this.destino = destino;
  }

  // Si el modo cambió desde que se creó este objeto, la conexión puede estar cerrada o ser de
  // otro destino: se rechaza en lugar de escribir donde no toca.
  #conexion() {
    if (this.#gestor.generacion !== this.#generacion) throw new ModoCambiadoError();
    return this.#db;
  }

  obtenerParticipacion(mesaId, corteId) {
    return this.#conexion()
      .prepare('SELECT * FROM participacion WHERE mesa_id = ? AND corte_id = ?')
      .get(mesaId, corteId);
  }

  listarParticipacion(mesaId = null) {
    return this.#conexion()
      .prepare('SELECT * FROM participacion WHERE (? IS NULL OR mesa_id = ?) ORDER BY mesa_id, corte_id')
      .all(mesaId, mesaId);
  }

  // Inserta o actualiza el acumulado de una mesa en un corte y lo audita en la MISMA base.
  // No valida reglas de negocio (censo, monotonía...): eso lo hace la capa de validación.
  guardarParticipacion({ mesaId, corteId, votantes, actor }) {
    const db = this.#conexion();
    return db.transaction(() => {
      const previa = db
        .prepare('SELECT * FROM participacion WHERE mesa_id = ? AND corte_id = ?')
        .get(mesaId, corteId);
      if (previa && previa.votantes_acumulados === votantes && previa.introducido_por_tipo === actor.tipo) {
        // Mismo dato del mismo tipo de autor (p. ej. un reintento tras un corte de conexión): no se toca ni se audita.
        return { id: previa.id, anterior: votantes, nuevo: votantes, cambiado: false };
      }
      const ahora = new Date().toISOString();
      let id;
      if (previa) {
        id = previa.id;
        db.prepare(
          `UPDATE participacion SET votantes_acumulados = ?, introducido_por_tipo = ?,
             introducido_por_id = ?, actualizado_en = ? WHERE id = ?`
        ).run(votantes, actor.tipo, actor.id ?? null, ahora, id);
      } else {
        id = Number(
          db
            .prepare(
              `INSERT INTO participacion (mesa_id, corte_id, votantes_acumulados, introducido_por_tipo,
                 introducido_por_id, actualizado_en) VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(mesaId, corteId, votantes, actor.tipo, actor.id ?? null, ahora).lastInsertRowid
        );
      }
      auditar(
        db,
        actor,
        previa ? 'editar' : 'crear',
        'participacion',
        id,
        previa
          ? { mesa_id: mesaId, corte_id: corteId, votantes_acumulados: previa.votantes_acumulados, introducido_por_tipo: previa.introducido_por_tipo }
          : null,
        { mesa_id: mesaId, corte_id: corteId, votantes_acumulados: votantes, introducido_por_tipo: actor.tipo }
      );
      return { id, anterior: previa?.votantes_acumulados ?? null, nuevo: votantes, cambiado: true };
    })();
  }

  // Auditoría de la base de este destino (en demo.db, solo la de captura de prueba).
  auditoria(filtros, { limite }) {
    return listarAuditoria(this.#conexion(), filtros, { limite });
  }
  contarAuditoria(filtros) {
    return contarAuditoria(this.#conexion(), filtros);
  }
  accionesAuditoria() {
    return accionesDistintas(this.#conexion());
  }

  // Vacía una celda (solo el administrador; lo exige la capa de servicio). Se audita.
  eliminarParticipacion({ mesaId, corteId, actor }) {
    const db = this.#conexion();
    return db.transaction(() => {
      const previa = db
        .prepare('SELECT * FROM participacion WHERE mesa_id = ? AND corte_id = ?')
        .get(mesaId, corteId);
      if (!previa) return false;
      db.prepare('DELETE FROM participacion WHERE id = ?').run(previa.id);
      auditar(
        db,
        actor,
        'vaciar',
        'participacion',
        previa.id,
        { mesa_id: mesaId, corte_id: corteId, votantes_acumulados: previa.votantes_acumulados, introducido_por_tipo: previa.introducido_por_tipo },
        null
      );
      return true;
    })();
  }
}

// Cuántos datos hay en cada corte de una base de captura: Map corteId -> n. Solo lectura.
export function contarPorCorte(db) {
  return new Map(db.prepare('SELECT corte_id, COUNT(*) AS n FROM participacion GROUP BY corte_id').all().map((f) => [f.corte_id, f.n]));
}
