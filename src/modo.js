import { fechaMadrid } from './tiempo.js';

export const DEMO = 'DEMO';
export const REAL = 'REAL';

// ¿Ha llegado (a las 00:00 de Madrid) el día de las elecciones?
export const esDiaDeElecciones = (ahora, fechaElecciones) => fechaMadrid(ahora) >= fechaElecciones;

// Modo de trabajo efectivo. Función pura: el reloj y el override se inyectan.
//  - Automático: antes de la fecha de elecciones DEMO; desde las 00:00 de ese día REAL.
//  - Override manual: {modo, fijado_en}. Al llegar el día de las elecciones se anula cualquier
//    override fijado ANTES de ese día; uno fijado ese día o después sí se respeta.
export function modoEfectivo({ ahora, fechaElecciones, override = null }) {
  const diaDeElecciones = esDiaDeElecciones(ahora, fechaElecciones);
  const automatico = diaDeElecciones ? REAL : DEMO;
  const base = { automatico, diaDeElecciones, overrideCaducado: false };

  if (override) {
    const vigente = !diaDeElecciones || fechaMadrid(Date.parse(override.fijado_en)) >= fechaElecciones;
    if (vigente) return { ...base, modo: override.modo, origen: 'manual', fijadoEn: override.fijado_en };
    return { ...base, modo: automatico, origen: 'automatico', overrideCaducado: true };
  }
  return { ...base, modo: automatico, origen: 'automatico' };
}
