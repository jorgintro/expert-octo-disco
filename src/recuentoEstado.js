// Estado del recuento (apertura y «activado»), SEPARADO por modo: abrir el recuento en DEMO para
// practicar nunca lo deja abierto en REAL (REAL arranca siempre cerrado). Vive en `ajuste` (app.db).
import { leerAjuste, escribirAjuste } from './ajustes.js';

const sufijo = (modo) => (modo === 'REAL' ? 'real' : 'demo');
const claveAbierto = (modo) => `recuento_${sufijo(modo)}_abierto`;
const claveActivado = (modo) => `recuento_${sufijo(modo)}_activado`;

export const recuentoAbierto = (db, modo) => leerAjuste(db, claveAbierto(modo)) === '1';
// «Activado»: se ha abierto al menos una vez en ese modo. Bloquea la estructura de candidaturas.
export const recuentoActivado = (db, modo) => leerAjuste(db, claveActivado(modo)) === '1';

// La estructura de las candidaturas (crear, borrar, activar, ordenar, destacar) se bloquea en cuanto
// el recuento REAL se ha activado alguna vez (y se queda bloqueada aunque se cierre). La demo es
// desechable: solo bloquea mientras se está en DEMO, y «Reiniciar demo» la desbloquea.
export function estructuraBloqueada(db, modo) {
  return recuentoActivado(db, 'REAL') || (modo === 'DEMO' && recuentoActivado(db, 'DEMO'));
}

export function fijarAbierto(db, modo, abierto) {
  escribirAjuste(db, claveAbierto(modo), abierto ? '1' : '0');
  if (abierto) escribirAjuste(db, claveActivado(modo), '1');
}

// Al entrar o salir de DEMO, o al reiniciarla, la demo vuelve a empezar: cerrada y sin activar.
export function reiniciarBanderasDemo(db) {
  escribirAjuste(db, claveAbierto('DEMO'), '0');
  escribirAjuste(db, claveActivado('DEMO'), '0');
  escribirAjuste(db, claveSenadoAbierto('DEMO'), '0');
  escribirAjuste(db, claveSenadoActivado('DEMO'), '0');
}

// ---- Senado: interruptor propio, independiente del Congreso, también separado por modo ----
const claveSenadoAbierto = (modo) => `senado_${sufijo(modo)}_abierto`;
const claveSenadoActivado = (modo) => `senado_${sufijo(modo)}_activado`;

export const senadoAbierto = (db, modo) => leerAjuste(db, claveSenadoAbierto(modo)) === '1';
export const senadoActivado = (db, modo) => leerAjuste(db, claveSenadoActivado(modo)) === '1';

// Mismo criterio que el Congreso: la estructura de los candidatos (alta, orden, activo) se bloquea al activar el
// Senado en REAL (para siempre) o en DEMO (mientras se practica; «Reiniciar demo» la desbloquea).
export function estructuraSenadoBloqueada(db, modo) {
  return senadoActivado(db, 'REAL') || (modo === 'DEMO' && senadoActivado(db, 'DEMO'));
}

export function fijarSenadoAbierto(db, modo, abierto) {
  escribirAjuste(db, claveSenadoAbierto(modo), abierto ? '1' : '0');
  if (abierto) escribirAjuste(db, claveSenadoActivado(modo), '1');
}
