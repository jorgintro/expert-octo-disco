import argon2 from 'argon2';

export const MAX_PASSWORD = 200;

// Comprueba la contraseña de un administrador. No registra fallos: lo hace quien llama.
export async function verificarPasswordAdmin(db, adminId, contrasena) {
  if (typeof contrasena !== 'string' || contrasena.length === 0 || contrasena.length > MAX_PASSWORD) return false;
  const fila = db.prepare('SELECT password_hash FROM admin WHERE id = ?').get(adminId);
  if (!fila) return false;
  return argon2.verify(fila.password_hash, contrasena).catch(() => false);
}
