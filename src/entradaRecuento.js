// Utilidades de las rutas de recuento: lectura del formulario y respuestas JSON del autoguardado.
import { formatearMadrid } from './tiempo.js';

// El formulario envía votantes, blancos, nulos y v_<id> por candidatura (todo texto).
export function entradaDeBody(body, candidaturas) {
  return {
    votantes: String(body?.votantes ?? ''),
    blancos: String(body?.blancos ?? ''),
    nulos: String(body?.nulos ?? ''),
    votos: Object.fromEntries(candidaturas.map((c) => [c.id, String(body?.[`v_${c.id}`] ?? '')])),
  };
}

// Valores en texto para volver a pintar el formulario con lo que escribió el usuario.
export const valoresDeEntrada = (entrada) => ({ ...entrada });

export const versionDeBody = (body) => (/^\d{1,9}$/.test(String(body?.version ?? '')) ? Number(body.version) : null);

export const esPeticionFetch = (req) => req.headers['x-requested-with'] === 'fetch';

// Código HTTP de cada resultado.
const CODIGOS = { guardado: 200, cerrado: 200, confirmar: 200, error: 422, conflicto: 409, recuento_cerrado: 403, mesa_cerrada: 403, bloqueado: 403, no_encontrado: 404 };
export const codigoHttp = (r) => CODIGOS[r.estado] ?? 500;

export function jsonDeResultado(r) {
  const ok = r.estado === 'guardado' || r.estado === 'cerrado';
  return {
    ok,
    estado: r.estado,
    ...(ok ? { version: r.version, cambiado: r.cambiado, guardadoEn: formatearMadrid(r.actualizadoEn ?? new Date().toISOString()).split(' ')[1], avisos: r.avisos, suma: r.suma } : {}),
    ...(r.estado === 'conflicto' ? { version: r.versionActual, mensaje: r.mensaje } : {}),
    ...(r.estado === 'error' ? { errores: r.errores } : {}),
    ...(r.mensaje && r.estado !== 'conflicto' ? { mensaje: r.mensaje } : {}),
  };
}
