import { createHmac, randomInt } from 'node:crypto';

export function hmacPin(secreto, pin) {
  return createHmac('sha256', secreto).update(pin).digest('hex');
}

// Genera un PIN de 6 dígitos cuyo HMAC no esté ya en uso. Devuelve el PIN en claro y su HMAC.
export function generarPin(db, secreto) {
  const existe = db.prepare('SELECT 1 FROM agente WHERE pin_hmac = ?');
  for (let i = 0; i < 100; i++) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const hmac = hmacPin(secreto, pin);
    if (!existe.get(hmac)) return { pin, hmac };
  }
  throw new Error('No se ha podido generar un PIN único');
}
