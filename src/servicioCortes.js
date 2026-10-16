// Edición de las horas de los cortes: validación, aviso si hay datos y auditoría.
import { auditar } from './auditoria.js';

export const FORMATO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// cortes: [{id, hora, orden}] en orden; entrada: { [id]: texto }. Devuelve errores y los cambios reales.
export function validarHoras(cortes, entrada) {
  const errores = [];
  const nuevas = cortes.map((c) => String(entrada[c.id] ?? c.hora).trim());
  cortes.forEach((c, i) => {
    if (!FORMATO_HORA.test(nuevas[i])) errores.push(`Corte ${i + 1}: «${nuevas[i]}» no es una hora válida (formato HH:MM, de 00:00 a 23:59).`);
  });
  if (errores.length === 0) {
    for (let i = 1; i < nuevas.length; i++) {
      if (nuevas[i] <= nuevas[i - 1]) {
        errores.push(`Las horas deben ir en orden creciente: ${nuevas[i]} (corte ${i + 1}) no es posterior a ${nuevas[i - 1]} (corte ${i}).`);
      }
    }
  }
  const cambios = errores.length === 0 ? cortes.map((c, i) => ({ corte: c, nueva: nuevas[i] })).filter((x) => x.nueva !== x.corte.hora) : [];
  return { errores, nuevas, cambios };
}

// Cambios que afectan a cortes con datos: [{corte, nueva, real, demo}].
export function cambiosConDatos(cambios, { real, demo }) {
  return cambios
    .map((c) => ({ ...c, real: real.get(c.corte.id) ?? 0, demo: demo.get(c.corte.id) ?? 0 }))
    .filter((c) => c.real + c.demo > 0);
}

// Aplica y audita en una transacción. `hora` es UNIQUE: se pasa por valores temporales para poder
// intercambiar o desplazar horas sin choques intermedios.
export function aplicarCambios(db, cambios, actor) {
  db.transaction(() => {
    const poner = db.prepare('UPDATE corte SET hora = ? WHERE id = ?');
    for (const { corte } of cambios) poner.run(`~${corte.id}`, corte.id);
    for (const { corte, nueva } of cambios) {
      poner.run(nueva, corte.id);
      auditar(db, actor, 'editar', 'corte', corte.id, { hora: corte.hora }, { hora: nueva });
    }
  })();
}
