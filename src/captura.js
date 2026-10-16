// ÚNICA capa con SQL sobre las tablas de captura (participación y recuento del Congreso y del Senado).
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

// Otro dispositivo guardó esta mesa después de que se cargara el formulario.
export class ConflictoVersionError extends Error {
  constructor(versionActual) {
    super('Esta mesa ha sido modificada desde otro dispositivo.');
    this.name = 'ConflictoVersionError';
    this.versionActual = versionActual;
  }
}

const ELECCION = 'congreso';

// Foto de lo introducido en una mesa para comparar y auditar (solo valores; sin rellenar = null).
const foto = (cab, votos) => ({
  estado: cab?.estado ?? null,
  votantes: cab?.votantes ?? null,
  blancos: cab?.votos_blancos ?? null,
  nulos: cab?.votos_nulos ?? null,
  votos: Object.fromEntries([...votos.entries()].map(([id, v]) => [String(id), v])),
});

// Foto del recuento del Senado de una mesa (sin rellenar = null).
const fotoSenado = (cab, votos, matriz) => ({
  modo: cab?.modo ?? null,
  estado: cab?.estado ?? null,
  validas: cab?.validas ?? null,
  blancas: cab?.blancas ?? null,
  nulas: cab?.nulas ?? null,
  votos: Object.fromEntries([...votos.entries()].map(([id, v]) => [String(id), v])),
  matriz: Object.fromEntries([...matriz.entries()]),
});

// Una mesa del Senado ya usa otro modo (sábana / totales): solo el administrador puede reiniciarla.
export class ModoSenadoError extends Error {
  constructor(modoActual) {
    super('Esta mesa ya usa otro modo de recuento del Senado.');
    this.name = 'ModoSenadoError';
    this.modoActual = modoActual;
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

  // ---- Recuento del Congreso ----
  // «Sin rellenar» (NULL / sin fila) se distingue de «0».
  obtenerRecuento(mesaId) {
    const db = this.#conexion();
    const cab = db.prepare('SELECT * FROM recuento_mesa WHERE mesa_id = ? AND eleccion = ?').get(mesaId, ELECCION) ?? null;
    const votos = new Map(
      db.prepare('SELECT candidatura_id, votos FROM recuento_voto WHERE mesa_id = ?').all(mesaId).map((r) => [r.candidatura_id, r.votos])
    );
    return { cab, votos };
  }

  // Todas las mesas con recuento: Map mesaId -> { cab, votos: Map candidaturaId -> votos }.
  listarRecuentos() {
    const db = this.#conexion();
    const mapa = new Map();
    for (const cab of db.prepare('SELECT * FROM recuento_mesa WHERE eleccion = ?').all(ELECCION)) {
      mapa.set(cab.mesa_id, { cab, votos: new Map() });
    }
    for (const v of db.prepare('SELECT mesa_id, candidatura_id, votos FROM recuento_voto').all()) {
      mapa.get(v.mesa_id)?.votos.set(v.candidatura_id, v.votos);
    }
    return mapa;
  }

  // Guarda lo introducido en una mesa (reemplaza los campos indicados; null = sin rellenar) y audita
  // SOLO lo que cambia. `versionEsperada` es la que tenía el formulario (0 si la mesa aún no existe):
  // si otro dispositivo guardó antes, lanza ConflictoVersionError sin escribir nada.
  // `estado` es el estado final ('borrador' | 'cerrado'). No valida reglas de negocio (suma, censo...):
  // eso lo hace la capa de servicio antes de llamar aquí.
  guardarRecuento({ mesaId, valores, estado, versionEsperada, actor, automatico = false }) {
    const db = this.#conexion();
    return db.transaction(() => {
      const previa = this.obtenerRecuento(mesaId);
      const versionActual = previa.cab?.version ?? 0;
      if (versionActual !== versionEsperada) throw new ConflictoVersionError(versionActual);

      const antes = foto(previa.cab, previa.votos);
      const votosNuevos = new Map(previa.votos);
      for (const [id, v] of valores.votos) {
        if (v === null || v === undefined) votosNuevos.delete(id);
        else votosNuevos.set(id, v);
      }
      const despues = {
        estado,
        votantes: valores.votantes === undefined ? antes.votantes : valores.votantes,
        blancos: valores.blancos === undefined ? antes.blancos : valores.blancos,
        nulos: valores.nulos === undefined ? antes.nulos : valores.nulos,
        votos: Object.fromEntries([...votosNuevos.entries()].map(([id, v]) => [String(id), v])),
      };

      // Diferencias (solo estas se auditan)
      const antesD = { mesa_id: mesaId };
      const despuesD = { mesa_id: mesaId };
      let valoresCambian = false;
      for (const campo of ['votantes', 'blancos', 'nulos']) {
        if (antes[campo] !== despues[campo]) {
          antesD[campo] = antes[campo];
          despuesD[campo] = despues[campo];
          valoresCambian = true;
        }
      }
      const idsVotos = new Set([...Object.keys(antes.votos), ...Object.keys(despues.votos)]);
      for (const id of idsVotos) {
        const a = antes.votos[id] ?? null;
        const d = despues.votos[id] ?? null;
        if (a !== d) {
          (antesD.votos ??= {})[id] = a;
          (despuesD.votos ??= {})[id] = d;
          valoresCambian = true;
        }
      }
      const estadoCambia = antes.estado !== despues.estado;
      if (estadoCambia) {
        antesD.estado = antes.estado;
        despuesD.estado = despues.estado;
      }
      if (!valoresCambian && !estadoCambia && previa.cab) {
        return { cambiado: false, version: versionActual, actualizadoEn: previa.cab.actualizado_en };
      }

      // La autoría solo cambia si cambian valores (cerrar o reabrir sin tocar números no la cambia).
      const autor = valoresCambian || !previa.cab
        ? { tipo: actor.tipo, id: actor.id ?? null }
        : { tipo: previa.cab.introducido_por_tipo, id: previa.cab.introducido_por_id };
      const version = versionActual + 1;
      const ahora = new Date().toISOString();
      db.prepare(
        `INSERT INTO recuento_mesa (mesa_id, eleccion, votantes, votos_blancos, votos_nulos, estado, version,
           introducido_por_tipo, introducido_por_id, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(mesa_id, eleccion) DO UPDATE SET votantes = excluded.votantes, votos_blancos = excluded.votos_blancos,
           votos_nulos = excluded.votos_nulos, estado = excluded.estado, version = excluded.version,
           introducido_por_tipo = excluded.introducido_por_tipo, introducido_por_id = excluded.introducido_por_id,
           actualizado_en = excluded.actualizado_en`
      ).run(mesaId, ELECCION, despues.votantes, despues.blancos, despues.nulos, estado, version, autor.tipo, autor.id, ahora);
      const borrar = db.prepare('DELETE FROM recuento_voto WHERE mesa_id = ? AND candidatura_id = ?');
      const poner = db.prepare(
        'INSERT INTO recuento_voto (mesa_id, candidatura_id, votos) VALUES (?, ?, ?) ON CONFLICT(mesa_id, candidatura_id) DO UPDATE SET votos = excluded.votos'
      );
      for (const [id, v] of valores.votos) {
        if (v === null || v === undefined) borrar.run(mesaId, id);
        else poner.run(mesaId, id, v);
      }

      const accion = estado === 'cerrado' && antes.estado !== 'cerrado' ? 'cerrar' : antes.estado === 'cerrado' ? 'editar' : automatico ? 'autoguardar' : 'guardar';
      auditar(db, actor, accion, 'recuento', mesaId, previa.cab ? antesD : null, despuesD);
      return { cambiado: true, version, actualizadoEn: ahora };
    })();
  }

  // Reabre una mesa cerrada: vuelve a borrador conservando los datos (y su autoría).
  reabrirRecuento({ mesaId, versionEsperada, actor }) {
    const db = this.#conexion();
    return db.transaction(() => {
      const { cab } = this.obtenerRecuento(mesaId);
      const versionActual = cab?.version ?? 0;
      if (versionActual !== versionEsperada) throw new ConflictoVersionError(versionActual);
      if (!cab || cab.estado !== 'cerrado') return { cambiado: false, version: versionActual };
      const version = versionActual + 1;
      const ahora = new Date().toISOString();
      db.prepare("UPDATE recuento_mesa SET estado = 'borrador', version = ?, actualizado_en = ? WHERE mesa_id = ? AND eleccion = ?").run(version, ahora, mesaId, ELECCION);
      auditar(db, actor, 'reabrir', 'recuento', mesaId, { mesa_id: mesaId, estado: 'cerrado' }, { mesa_id: mesaId, estado: 'borrador' });
      return { cambiado: true, version, actualizadoEn: ahora };
    })();
  }

  // ---- Recuento del Senado (solo contadores) ----
  obtenerSenado(mesaId) {
    const db = this.#conexion();
    const cab = db.prepare('SELECT * FROM senado_mesa WHERE mesa_id = ?').get(mesaId) ?? null;
    const votos = new Map(db.prepare('SELECT candidato_id, votos FROM senado_voto WHERE mesa_id = ?').all(mesaId).map((r) => [r.candidato_id, r.votos]));
    const matriz = new Map(
      db.prepare('SELECT marcas, mismo_partido, papeletas FROM senado_matriz WHERE mesa_id = ?').all(mesaId).map((r) => [`${r.marcas}:${r.mismo_partido}`, r.papeletas])
    );
    return { cab, votos, matriz };
  }

  // Todas las mesas con recuento del Senado: Map mesaId -> { cab, votos: Map, matriz: Map }.
  listarSenado() {
    const db = this.#conexion();
    const mapa = new Map();
    for (const cab of db.prepare('SELECT * FROM senado_mesa').all()) mapa.set(cab.mesa_id, { cab, votos: new Map(), matriz: new Map() });
    for (const v of db.prepare('SELECT mesa_id, candidato_id, votos FROM senado_voto').all()) mapa.get(v.mesa_id)?.votos.set(v.candidato_id, v.votos);
    for (const m of db.prepare('SELECT mesa_id, marcas, mismo_partido, papeletas FROM senado_matriz').all()) {
      mapa.get(m.mesa_id)?.matriz.set(`${m.marcas}:${m.mismo_partido}`, m.papeletas);
    }
    return mapa;
  }

  // Guarda los contadores de una mesa (reemplaza los indicados; null = sin rellenar) y audita SOLO lo que cambia.
  // valores: { modo, votos: Map, matriz: Map|null (solo sábana), validas, blancas, nulas }. El modo queda fijado al
  // primer guardado; cambiarlo exige reiniciar antes (administrador). `versionEsperada`: 0 si la mesa aún no existe.
  // No valida reglas de negocio (marcas, censo...): eso lo hace la capa de servicio.
  guardarSenado({ mesaId, valores, estado, versionEsperada, actor, automatico = false }) {
    const db = this.#conexion();
    return db.transaction(() => {
      const previa = this.obtenerSenado(mesaId);
      const versionActual = previa.cab?.version ?? 0;
      if (versionActual !== versionEsperada) throw new ConflictoVersionError(versionActual);
      if (previa.cab && previa.cab.modo !== valores.modo) throw new ModoSenadoError(previa.cab.modo);

      const antes = fotoSenado(previa.cab, previa.votos, previa.matriz);
      const votosNuevos = new Map(previa.votos);
      for (const [id, v] of valores.votos) {
        if (v === null || v === undefined) votosNuevos.delete(id);
        else votosNuevos.set(id, v);
      }
      const matrizNueva = valores.matriz ? new Map(valores.matriz) : new Map();
      const despues = {
        modo: valores.modo,
        estado,
        validas: valores.validas === undefined ? antes.validas : valores.validas,
        blancas: valores.blancas === undefined ? antes.blancas : valores.blancas,
        nulas: valores.nulas === undefined ? antes.nulas : valores.nulas,
        votos: Object.fromEntries([...votosNuevos.entries()].map(([id, v]) => [String(id), v])),
        matriz: Object.fromEntries([...matrizNueva.entries()]),
      };

      const antesD = { mesa_id: mesaId };
      const despuesD = { mesa_id: mesaId };
      let valoresCambian = false;
      for (const campo of ['validas', 'blancas', 'nulas']) {
        if (antes[campo] !== despues[campo]) {
          antesD[campo] = antes[campo];
          despuesD[campo] = despues[campo];
          valoresCambian = true;
        }
      }
      for (const [grupo, nombre] of [['votos', 'votos'], ['matriz', 'matriz']]) {
        for (const clave of new Set([...Object.keys(antes[grupo]), ...Object.keys(despues[grupo])])) {
          const a = antes[grupo][clave] ?? null;
          const d = despues[grupo][clave] ?? null;
          if (a !== d) {
            (antesD[nombre] ??= {})[clave] = a;
            (despuesD[nombre] ??= {})[clave] = d;
            valoresCambian = true;
          }
        }
      }
      const estadoCambia = antes.estado !== despues.estado;
      if (estadoCambia) {
        antesD.estado = antes.estado;
        despuesD.estado = despues.estado;
      }
      if (!previa.cab) despuesD.modo = valores.modo;
      if (!valoresCambian && !estadoCambia && previa.cab) {
        return { cambiado: false, version: versionActual, actualizadoEn: previa.cab.actualizado_en };
      }

      const autor = valoresCambian || !previa.cab
        ? { tipo: actor.tipo, id: actor.id ?? null }
        : { tipo: previa.cab.introducido_por_tipo, id: previa.cab.introducido_por_id };
      const version = versionActual + 1;
      const ahora = new Date().toISOString();
      db.prepare(
        `INSERT INTO senado_mesa (mesa_id, modo, validas, blancas, nulas, estado, version, introducido_por_tipo, introducido_por_id, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(mesa_id) DO UPDATE SET validas = excluded.validas, blancas = excluded.blancas, nulas = excluded.nulas,
           estado = excluded.estado, version = excluded.version, introducido_por_tipo = excluded.introducido_por_tipo,
           introducido_por_id = excluded.introducido_por_id, actualizado_en = excluded.actualizado_en`
      ).run(mesaId, valores.modo, despues.validas, despues.blancas, despues.nulas, estado, version, autor.tipo, autor.id, ahora);
      const borrar = db.prepare('DELETE FROM senado_voto WHERE mesa_id = ? AND candidato_id = ?');
      const poner = db.prepare('INSERT INTO senado_voto (mesa_id, candidato_id, votos) VALUES (?, ?, ?) ON CONFLICT(mesa_id, candidato_id) DO UPDATE SET votos = excluded.votos');
      for (const [id, v] of valores.votos) {
        if (v === null || v === undefined) borrar.run(mesaId, id);
        else poner.run(mesaId, id, v);
      }
      db.prepare('DELETE FROM senado_matriz WHERE mesa_id = ?').run(mesaId);
      for (const [celda, n] of matrizNueva) {
        const [marcas, misma] = celda.split(':').map(Number);
        db.prepare('INSERT INTO senado_matriz (mesa_id, marcas, mismo_partido, papeletas) VALUES (?, ?, ?, ?)').run(mesaId, marcas, misma, n);
      }

      const accion = estado === 'cerrado' && antes.estado !== 'cerrado' ? 'cerrar' : antes.estado === 'cerrado' ? 'editar' : automatico ? 'autoguardar' : 'guardar';
      auditar(db, actor, accion, 'senado', mesaId, previa.cab ? antesD : null, despuesD);
      return { cambiado: true, version, actualizadoEn: ahora };
    })();
  }

  // Reabre una mesa cerrada del Senado: vuelve a borrador conservando los datos (y su autoría).
  reabrirSenado({ mesaId, versionEsperada, actor }) {
    const db = this.#conexion();
    return db.transaction(() => {
      const { cab } = this.obtenerSenado(mesaId);
      const versionActual = cab?.version ?? 0;
      if (versionActual !== versionEsperada) throw new ConflictoVersionError(versionActual);
      if (!cab || cab.estado !== 'cerrado') return { cambiado: false, version: versionActual };
      const version = versionActual + 1;
      const ahora = new Date().toISOString();
      db.prepare("UPDATE senado_mesa SET estado = 'borrador', version = ?, actualizado_en = ? WHERE mesa_id = ?").run(version, ahora, mesaId);
      auditar(db, actor, 'reabrir', 'senado', mesaId, { mesa_id: mesaId, estado: 'cerrado' }, { mesa_id: mesaId, estado: 'borrador' });
      return { cambiado: true, version, actualizadoEn: ahora };
    })();
  }

  // Pasa una mesa del Senado de «sábana» a «totales» CONSERVANDO las cifras (votos por candidato, válidas, blancas y
  // nulas); la matriz de marcas se descarta (la mesa deja de contar en la estadística de bloque). Solo el administrador
  // (lo exige el servicio). `estadoFinal`: 'cerrado' solo si estaba cerrada; en otro caso queda en borrador.
  // Se audita con la foto completa de antes y de después.
  convertirSenadoATotales({ mesaId, versionEsperada, actor, estadoFinal }) {
    const db = this.#conexion();
    return db.transaction(() => {
      const previa = this.obtenerSenado(mesaId);
      if (!previa.cab || previa.cab.modo !== 'sabana') return { cambiado: false };
      if (previa.cab.version !== versionEsperada) throw new ConflictoVersionError(previa.cab.version);
      const estado = previa.cab.estado === 'cerrado' && estadoFinal === 'cerrado' ? 'cerrado' : 'borrador';
      const version = previa.cab.version + 1;
      const ahora = new Date().toISOString();
      db.prepare("UPDATE senado_mesa SET modo = 'totales', estado = ?, version = ?, introducido_por_tipo = ?, introducido_por_id = ?, actualizado_en = ? WHERE mesa_id = ?")
        .run(estado, version, actor.tipo, actor.id ?? null, ahora, mesaId);
      db.prepare('DELETE FROM senado_matriz WHERE mesa_id = ?').run(mesaId);
      const antes = fotoSenado(previa.cab, previa.votos, previa.matriz);
      const despues = fotoSenado({ ...previa.cab, modo: 'totales', estado }, previa.votos, new Map());
      auditar(db, actor, 'pasar_a_totales', 'senado', mesaId, { mesa_id: mesaId, ...antes }, { mesa_id: mesaId, ...despues });
      return { cambiado: true, version, estado, actualizadoEn: ahora };
    })();
  }

  // Borra TODO el recuento del Senado de una mesa (para poder cambiar de modo). Solo el administrador; lo exige el
  // servicio. Se audita con la foto de lo que había.
  reiniciarSenado({ mesaId, versionEsperada, actor }) {
    const db = this.#conexion();
    return db.transaction(() => {
      const previa = this.obtenerSenado(mesaId);
      if (!previa.cab) return { cambiado: false };
      if (previa.cab.version !== versionEsperada) throw new ConflictoVersionError(previa.cab.version);
      db.prepare('DELETE FROM senado_voto WHERE mesa_id = ?').run(mesaId);
      db.prepare('DELETE FROM senado_matriz WHERE mesa_id = ?').run(mesaId);
      db.prepare('DELETE FROM senado_mesa WHERE mesa_id = ?').run(mesaId);
      auditar(db, actor, 'reiniciar', 'senado', mesaId, { mesa_id: mesaId, ...fotoSenado(previa.cab, previa.votos, previa.matriz) }, null);
      return { cambiado: true };
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

// Cuántas filas de votos tiene cada candidatura en una base de captura: Map candidaturaId -> n. Solo lectura.
export function contarPorCandidatura(db) {
  return new Map(db.prepare('SELECT candidatura_id, COUNT(*) AS n FROM recuento_voto GROUP BY candidatura_id').all().map((f) => [f.candidatura_id, f.n]));
}

// Cuántas filas de votos tiene cada candidato del Senado en una base de captura: Map candidatoId -> n. Solo lectura.
export function contarPorCandidato(db) {
  return new Map(db.prepare('SELECT candidato_id, COUNT(*) AS n FROM senado_voto GROUP BY candidato_id').all().map((f) => [f.candidato_id, f.n]));
}
