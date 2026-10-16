// Todas las fechas se guardan en UTC; aquí se convierten a Europe/Madrid para decidir y mostrar.
const ZONA = 'Europe/Madrid';

const formatoFecha = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const formatoCompleto = new Intl.DateTimeFormat('es-ES', {
  timeZone: ZONA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

// 'YYYY-MM-DD' en Madrid del instante dado (ms desde epoch).
export const fechaMadrid = (ms) => formatoFecha.format(new Date(ms));

// 'DD/MM/AAAA HH:MM:SS' en Madrid. Acepta ms o una cadena ISO.
export const formatearMadrid = (valor) => formatoCompleto.format(new Date(valor)).replace(',', '');

// 'YYYY-MM-DD' -> 'DD/MM/AAAA'
export const fechaLarga = (iso) => iso.split('-').reverse().join('/');

// Valida 'YYYY-MM-DD' como fecha real del calendario.
export function esFechaValida(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return false;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  return f.getUTCFullYear() === anio && f.getUTCMonth() === mes - 1 && f.getUTCDate() === dia;
}

const formatoHora = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// 'HH:MM' en Madrid del instante dado (ms). Comparable como texto con la hora de un corte.
export const horaMadrid = (ms) => formatoHora.format(new Date(ms));
