// Gestor de datos: decide a qué base va la captura según el modo de trabajo (DEMO / REAL) y
// aplica las transiciones de modo.
//
//  - app.db  : configuración y captura REAL (conexión principal, `db`).
//  - demo.db : SOLO captura de prueba y su auditoría; existe únicamente mientras se está en DEMO.
//
// Concurrencia: Node ejecuta el código síncrono sin interrupciones y `sincronizar()` no tiene ningún
// `await`, así que una transición es atómica respecto a las demás peticiones del proceso. Es también
// idempotente: puede repetirse (p. ej. tras caerse a medias) y converge al mismo estado. La app corre
// en UN solo proceso; no está pensada para varios trabajadores sobre el mismo data/.
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { auditar } from './auditoria.js';
import { Captura, NOMBRE_DEMO, contarPorCandidato, contarPorCandidatura, contarPorCorte } from './captura.js';
import { abrirDb, migrarDemo } from './db.js';
import { DEMO, REAL, modoEfectivo } from './modo.js';
import { reiniciarBanderasDemo } from './recuentoEstado.js';

export { NOMBRE_DEMO };
export const TABLAS_CAPTURA = ['participacion', 'recuento_mesa', 'senado_mesa'];
const SUFIJOS_SQLITE = ['', '-wal', '-shm'];
const SISTEMA = { tipo: 'sistema', id: null };

export const rutaDemo = (dataDir) => path.join(dataDir, NOMBRE_DEMO);

// Única puerta de borrado: solo admite un fichero llamado demo.db y nunca el de la base principal.
export function asegurarQueEsDemo(ruta, rutaApp = null) {
  const absoluta = path.resolve(ruta);
  if (path.basename(absoluta) !== NOMBRE_DEMO) {
    throw new Error(`Se niega a borrar ${absoluta}: solo se puede borrar ${NOMBRE_DEMO}`);
  }
  if (rutaApp && rutaApp !== ':memory:' && path.resolve(rutaApp) === absoluta) {
    throw new Error(`Se niega a borrar ${absoluta}: es la base principal`);
  }
  return absoluta;
}

export function borrarArchivosDemo(ruta, rutaApp = null) {
  const base = asegurarQueEsDemo(ruta, rutaApp);
  for (const sufijo of SUFIJOS_SQLITE) rmSync(base + sufijo, { force: true });
}

export class GestorDatos {
  #db;
  #ruta;
  #fechaElecciones;
  #reloj;
  #demo = null;

  constructor({ db, dataDir, fechaElecciones, reloj = Date.now }) {
    this.#db = db;
    this.#ruta = rutaDemo(dataDir); // constante fija: <dataDir>/demo.db
    this.#fechaElecciones = fechaElecciones;
    this.#reloj = reloj;
    this.generacion = 0; // cambia cada vez que cambia la conexión de demo
    this.estado = null;
  }

  get rutaDemo() {
    return this.#ruta;
  }

  // ---- Estado persistido en ajuste (app.db) ----
  #leerAjuste(clave) {
    return this.#db.prepare('SELECT valor FROM ajuste WHERE clave = ?').get(clave)?.valor ?? null;
  }
  #escribirAjuste(clave, valor) {
    this.#db
      .prepare('INSERT INTO ajuste (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')
      .run(clave, valor);
  }
  #leerOverride() {
    const crudo = this.#leerAjuste('modo_manual');
    if (!crudo) return null;
    try {
      const o = JSON.parse(crudo);
      const valido = (o.modo === DEMO || o.modo === REAL) && Number.isFinite(Date.parse(o.fijado_en));
      return valido ? o : null;
    } catch {
      return null;
    }
  }

  // ---- demo.db ----
  #recrearDemoVacia() {
    this.#demo?.close();
    this.#demo = null;
    borrarArchivosDemo(this.#ruta, this.#db.name);
    this.#demo = abrirDb(this.#ruta);
    migrarDemo(this.#demo);
    reiniciarBanderasDemo(this.#db); // la demo empieza de cero: recuento cerrado y sin activar
    this.generacion++;
  }
  #eliminarDemo() {
    this.#demo?.close();
    this.#demo = null;
    borrarArchivosDemo(this.#ruta, this.#db.name);
    reiniciarBanderasDemo(this.#db);
    this.generacion++;
  }
  // Deja demo.db coherente con el modo: DEMO => existe y está abierta; REAL => no existe.
  #reconciliar(modo) {
    if (modo === DEMO) {
      if (!this.#demo) {
        this.#demo = abrirDb(this.#ruta); // arranque del proceso: se conserva lo que hubiera
        migrarDemo(this.#demo);
        this.generacion++;
      } else if (!existsSync(this.#ruta)) {
        this.#recrearDemoVacia(); // alguien borró el fichero con la app en marcha
      }
    } else if (this.#demo || existsSync(this.#ruta)) {
      this.#eliminarDemo();
    }
  }

  // Evalúa el modo con el reloj actual y aplica lo que corresponda. Síncrono e idempotente.
  // Se llama al inicio de cada petición.
  sincronizar() {
    const ahora = this.#reloj();
    const override = this.#leerOverride();
    const efectivo = modoEfectivo({ ahora, fechaElecciones: this.#fechaElecciones, override });

    if (efectivo.overrideCaducado) {
      this.#db.transaction(() => {
        this.#db.prepare("DELETE FROM ajuste WHERE clave = 'modo_manual'").run();
        auditar(this.#db, SISTEMA, 'anular_override_modo', 'modo', null, override, { motivo: 'llegó el día de las elecciones' });
      })();
    }

    const aplicado = this.#leerAjuste('modo_aplicado');
    if (aplicado !== efectivo.modo) {
      // Primero el efecto sobre demo.db y después se anota: si se cae entre medias, la siguiente
      // petición ve la diferencia y repite el mismo paso (idempotente).
      if (efectivo.modo === DEMO) this.#recrearDemoVacia();
      else this.#eliminarDemo();
      this.#db.transaction(() => {
        this.#escribirAjuste('modo_aplicado', efectivo.modo);
        if (efectivo.origen === 'automatico') {
          auditar(this.#db, SISTEMA, 'cambio_modo', 'modo', null, aplicado ? { modo: aplicado } : null, { modo: efectivo.modo, origen: 'automatico' });
        }
      })();
    } else {
      this.#reconciliar(efectivo.modo);
    }

    this.estado = { ...efectivo, ahora, fechaElecciones: this.#fechaElecciones };
    return this.estado;
  }

  // Objeto de captura atado al destino del modo vigente (llamar tras sincronizar()).
  captura() {
    if (!this.estado) throw new Error('El modo aún no se ha evaluado');
    return this.estado.modo === DEMO
      ? new Captura(this, 'demo', this.#demo, this.generacion)
      : new Captura(this, 'real', this.#db, this.generacion);
  }

  // Cambio manual de modo. Idempotente: si ya se está en ese modo no hace nada.
  // Pasar a DEMO desde el día de las elecciones exige `enJornadaConfirmada` (la ruta lo pide).
  cambiarModo(nuevo, actor, { enJornadaConfirmada = false } = {}) {
    if (nuevo !== DEMO && nuevo !== REAL) throw new Error(`Modo desconocido: ${nuevo}`);
    const antes = this.sincronizar();
    if (nuevo === DEMO && antes.diaDeElecciones && !enJornadaConfirmada) {
      throw new Error('Pasar a DEMO desde el día de las elecciones exige la confirmación reforzada');
    }
    if (antes.modo === nuevo) return antes;
    const ahora = this.#reloj();
    this.#db.transaction(() => {
      this.#escribirAjuste('modo_manual', JSON.stringify({ modo: nuevo, fijado_en: new Date(ahora).toISOString() }));
      auditar(
        this.#db,
        actor,
        'cambiar_modo',
        'modo',
        null,
        { modo: antes.modo, origen: antes.origen },
        { modo: nuevo, origen: 'manual', en_jornada: antes.diaDeElecciones && nuevo === DEMO }
      );
    })();
    return this.sincronizar();
  }

  // Borra demo.db y la recrea vacía. Solo en DEMO. No toca app.db salvo para auditar la acción.
  reiniciarDemo(actor) {
    const estado = this.sincronizar();
    if (estado.modo !== DEMO) throw new Error('Solo se puede reiniciar la demo estando en modo DEMO');
    const registros = this.contarRegistrosDemo();
    this.#recrearDemoVacia();
    auditar(this.#db, actor, 'reiniciar_demo', 'modo', null, { registros }, null);
  }

  // Registros de captura de prueba que se perderían al salir de DEMO.
  contarRegistrosDemo() {
    if (!this.#demo) return 0;
    return TABLAS_CAPTURA.reduce((suma, tabla) => suma + this.#demo.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n, 0);
  }

  // Datos por corte en ambos destinos, SOLO LECTURA (para avisar antes de cambiar la hora de un corte,
  // que es configuración compartida por DEMO y REAL). Nunca escribe.
  contarDatosPorCorte() {
    return { real: contarPorCorte(this.#db), demo: this.#demo ? contarPorCorte(this.#demo) : new Map() };
  }

  // Votos por candidatura en ambos destinos, SOLO LECTURA (para impedir borrar una candidatura con votos).
  contarVotosPorCandidatura() {
    return { real: contarPorCandidatura(this.#db), demo: this.#demo ? contarPorCandidatura(this.#demo) : new Map() };
  }

  // Votos por candidato del Senado en ambos destinos, SOLO LECTURA (para impedir borrar un candidato con votos).
  contarVotosPorCandidato() {
    return { real: contarPorCandidato(this.#db), demo: this.#demo ? contarPorCandidato(this.#demo) : new Map() };
  }

  cerrar() {
    this.#demo?.close();
    this.#demo = null;
  }
}
