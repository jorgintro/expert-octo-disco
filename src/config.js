const EJEMPLO = 'cambiame';

// Lee y valida la configuración. Falla si faltan secretos o conservan el valor de ejemplo.
export function cargarConfig(env = process.env) {
  const errores = [];

  const secreto = (nombre, minimo) => {
    const valor = env[nombre] ?? '';
    if (valor.trim() === '' || valor === EJEMPLO) {
      errores.push(`${nombre} no está definida o conserva el valor de ejemplo`);
    } else if (valor.length < minimo) {
      errores.push(`${nombre} debe tener al menos ${minimo} caracteres`);
    }
    return valor;
  };

  const config = {
    puerto: Number(env.PORT) || 3000,
    dataDir: env.DATA_DIR || './data',
    sessionSecret: secreto('SESSION_SECRET', 32),
    pinHmacSecret: secreto('PIN_HMAC_SECRET', 32),
    adminUser: (env.ADMIN_USER ?? '').trim(),
    adminPasswordInitial: secreto('ADMIN_PASSWORD_INITIAL', 10),
    cookieSegura: env.COOKIE_SECURE !== 'false',
    trustProxy: 2,
  };

  // Saltos de proxy de confianza entre la app y el cliente (ver README, "IP real del cliente").
  // 2 = Cloudflare + Nginx Proxy Manager; 1 = solo NPM; 0 = acceso directo sin proxy.
  const saltos = (env.TRUST_PROXY ?? '2').trim();
  if (/^\d{1,2}$/.test(saltos)) config.trustProxy = Number(saltos);
  else errores.push('TRUST_PROXY debe ser un número entero de saltos de proxy (0, 1, 2...)');
  if (!config.adminUser) errores.push('ADMIN_USER no está definida');

  if (errores.length) {
    throw new Error(`Configuración no válida:\n- ${errores.join('\n- ')}`);
  }
  return config;
}
