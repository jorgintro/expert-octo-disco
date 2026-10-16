// Reglas de la papeleta del Senado (Madrid): hasta 3 marcas; más de 3 = nula; sin marcas = blanca.
// Funciones puras, SIN DOM: las usan el navegador (módulo ES, pantalla «sábana») y el servidor (src/senado.js),
// para que las pruebas ejerciten exactamente el mismo código que corre en el móvil.
export const MAX_MARCAS = 3;
export const CELDAS = ['1:1', '2:0', '2:1', '3:0', '3:1']; // «marcas:misma_lista» (con 1 marca siempre es 1)

export const claveCelda = (marcas, misma) => `${marcas}:${misma ? 1 : 0}`;

// marcas: ids de candidato marcados (sin repetir); grupoDe(id) -> clave de su lista.
export function clasificarPapeleta(marcas, grupoDe) {
  const ids = [...new Set(marcas)];
  if (ids.length === 0) return { tipo: 'blanca' };
  if (ids.length > MAX_MARCAS) return { tipo: 'nula' };
  const grupos = new Set(ids.map(grupoDe));
  return { tipo: 'valida', marcas: ids.length, misma: ids.length === 1 || grupos.size === 1, ids };
}

export function contadoresVacios(idsCandidatos) {
  return {
    votos: Object.fromEntries(idsCandidatos.map((id) => [id, 0])),
    matriz: Object.fromEntries(CELDAS.map((c) => [c, 0])),
    blancas: 0,
    nulas: 0,
  };
}

export const copiarContadores = (c) => ({ votos: { ...c.votos }, matriz: { ...c.matriz }, blancas: c.blancas, nulas: c.nulas });

// Suma (signo = 1) o resta (signo = -1) una papeleta clasificada. Devuelve contadores nuevos, o null si
// al restar algún contador quedaría negativo (no se puede deshacer algo que ya no está contado).
export function aplicarPapeleta(contadores, papeleta, signo = 1) {
  const c = copiarContadores(contadores);
  if (papeleta.tipo === 'blanca') c.blancas += signo;
  else if (papeleta.tipo === 'nula') c.nulas += signo;
  else {
    const celda = claveCelda(papeleta.marcas, papeleta.misma);
    c.matriz[celda] = (c.matriz[celda] ?? 0) + signo;
    for (const id of papeleta.ids) c.votos[id] = (c.votos[id] ?? 0) + signo;
  }
  const negativo = c.blancas < 0 || c.nulas < 0 || Object.values(c.matriz).some((v) => v < 0) || Object.values(c.votos).some((v) => v < 0);
  return negativo ? null : c;
}

// Resumen de los contadores: válidas por número de marcas, suma de marcas, papeletas contadas.
export function totalesContadores(c) {
  const validas = Object.values(c.matriz).reduce((a, v) => a + v, 0);
  const marcas = CELDAS.reduce((a, celda) => a + Number(celda[0]) * (c.matriz[celda] ?? 0), 0);
  return { validas, marcas, blancas: c.blancas, nulas: c.nulas, contadas: validas + c.blancas + c.nulas, votosCandidatos: Object.values(c.votos).reduce((a, v) => a + v, 0) };
}
