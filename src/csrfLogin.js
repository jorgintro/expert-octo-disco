import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const textoSeguro = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// CSRF para formularios de entrada (aún no hay sesión): el token del formulario es el HMAC del
// valor de una cookie HttpOnly. Un sitio externo no puede calcularlo sin SESSION_SECRET.
export function crearCsrfLogin({ secreto, cookie, ruta, segura }) {
  const firmar = (valor) => createHmac('sha256', secreto).update(`${cookie}:${valor}`).digest('base64url');
  return {
    // Pone la cookie y devuelve el token que va en el campo oculto `_csrf`.
    emitir(reply) {
      const valor = randomBytes(24).toString('base64url');
      reply.setCookie(cookie, valor, { httpOnly: true, secure: segura, sameSite: 'lax', path: ruta, maxAge: 3600 });
      return firmar(valor);
    },
    valido(req) {
      const valor = req.cookies[cookie];
      return typeof valor === 'string' && valor !== '' && textoSeguro(req.body?._csrf ?? '', firmar(valor));
    },
    borrar(reply) {
      reply.clearCookie(cookie, { path: ruta });
    },
  };
}
