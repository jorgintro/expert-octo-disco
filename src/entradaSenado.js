// Utilidades de las rutas del Senado: lectura del formulario y respuestas JSON del autoguardado.
// El formulario envía: modo, version, validas (solo totales), blancas, nulas, c_<id> por candidato y
// m_<marcas>_<mismo> (sábana). Todo texto.
import { CELDAS } from './senado.js';
import { formatearMadrid } from './tiempo.js';

export function entradaDeBody(body, candidatos) {
  return {
    modo: String(body?.modo ?? ''),
    validas: String(body?.validas ?? ''),
    blancas: String(body?.blancas ?? ''),
    nulas: String(body?.nulas ?? ''),
    votos: Object.fromEntries(candidatos.map((c) => [c.id, String(body?.[`c_${c.id}`] ?? '')])),
    matriz: Object.fromEntries(CELDAS.map((celda) => [celda, String(body?.[`m_${celda.replace(':', '_')}`] ?? '')])),
  };
}

// Valores en texto para volver a pintar el formulario con lo que escribió el usuario.
export const textoDe = (v) => (v === null || v === undefined ? '' : String(v));

export function valoresDeDatos({ cab, votos, matriz }) {
  return {
    modo: cab?.modo ?? '',
    validas: textoDe(cab?.validas),
    blancas: textoDe(cab?.blancas),
    nulas: textoDe(cab?.nulas),
    votos: Object.fromEntries([...votos].map(([id, v]) => [id, textoDe(v)])),
    matriz: Object.fromEntries([...matriz].map(([k, v]) => [k, textoDe(v)])),
  };
}

const CODIGOS = { guardado: 200, cerrado: 200, confirmar: 200, sin_datos: 200, error: 422, conflicto: 409, modo_distinto: 409, senado_cerrado: 403, mesa_cerrada: 403, bloqueado: 403, no_encontrado: 404 };
export const codigoHttp = (r) => CODIGOS[r.estado] ?? 500;

export function jsonDeResultado(r) {
  const ok = r.estado === 'guardado' || r.estado === 'cerrado' || r.estado === 'sin_datos';
  return {
    ok,
    estado: r.estado,
    ...(ok ? { version: r.version, cambiado: r.cambiado ?? false, guardadoEn: formatearMadrid(r.actualizadoEn ?? new Date().toISOString()).split(' ')[1], avisos: r.avisos ?? [], suma: r.suma ?? null } : {}),
    ...(r.estado === 'conflicto' ? { version: r.versionActual, mensaje: r.mensaje, contadores: r.contadores } : {}),
    ...(r.estado === 'error' ? { errores: r.errores } : {}),
    ...(r.mensaje && r.estado !== 'conflicto' ? { mensaje: r.mensaje } : {}),
  };
}
