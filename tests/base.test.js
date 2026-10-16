import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { abrirDb, migrar, migrarApp } from '../src/db.js';
import { sembrar } from '../src/seed.js';
import { cargarConfig } from '../src/config.js';
import { generarPin, hmacPin } from '../src/pin.js';
import { confiarEnProxy, esPrivada } from '../src/proxy.js';
import { CONFIG } from './ayuda.js';

const nuevaDb = () => {
  const db = abrirDb(':memory:');
  migrarApp(db);
  return db;
};

test('las migraciones son idempotentes', () => {
  const db = nuevaDb();
  migrarApp(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM migracion').get().n, 4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM migracion_captura').get().n, 3);
});

test('la base de datos usa WAL y claves foráneas', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tiroriro-'));
  try {
    const db = abrirDb(path.join(dir, 'app.db'));
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('el seed crea colegio, 6 mesas (censo 4181), 6 cortes y el administrador', async () => {
  const db = nuevaDb();
  await sembrar(db, CONFIG);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM colegio').get().n, 1);
  const mesas = db.prepare('SELECT COUNT(*) n, SUM(censo) censo FROM mesa').get();
  assert.deepEqual({ ...mesas }, { n: 6, censo: 4181 });
  assert.deepEqual(
    db.prepare('SELECT hora FROM corte ORDER BY orden').all().map((c) => c.hora),
    ['10:00', '12:00', '14:00', '16:00', '18:00', '20:00']
  );
  const admin = db.prepare('SELECT usuario, password_hash FROM admin').get();
  assert.equal(admin.usuario, 'admin');
  assert.match(admin.password_hash, /^\$argon2id\$/);
});

test('el seed es idempotente y no pisa datos editados', async () => {
  const db = nuevaDb();
  await sembrar(db, CONFIG);
  db.prepare("UPDATE mesa SET censo = 999 WHERE codigo = '4-2-A'").run();
  db.prepare("UPDATE mesa SET activa = 0 WHERE codigo = '5-31-U'").run();
  const hash = db.prepare('SELECT password_hash h FROM admin').get().h;
  await sembrar(db, { ...CONFIG, adminPasswordInitial: 'otra-contraseña-distinta' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mesa').get().n, 6);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM corte').get().n, 6);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM admin').get().n, 1);
  assert.equal(db.prepare("SELECT censo FROM mesa WHERE codigo = '4-2-A'").get().censo, 999);
  assert.equal(db.prepare("SELECT activa FROM mesa WHERE codigo = '5-31-U'").get().activa, 0);
  assert.equal(db.prepare('SELECT password_hash h FROM admin').get().h, hash);
});

test('ELECTION_DATE: valor por defecto 2026-11-29 y validación', () => {
  const ok = {
    SESSION_SECRET: 'a'.repeat(32),
    PIN_HMAC_SECRET: 'b'.repeat(32),
    ADMIN_USER: 'admin',
    ADMIN_PASSWORD_INITIAL: 'una-contraseña-larga',
  };
  assert.equal(cargarConfig(ok).fechaElecciones, '2026-11-29');
  assert.equal(cargarConfig({ ...ok, ELECTION_DATE: '2027-03-01' }).fechaElecciones, '2027-03-01');
  for (const mala of ['29/11/2026', '2026-13-01', '2026-02-30', 'mañana', '2026-11-29T00:00']) {
    assert.throws(() => cargarConfig({ ...ok, ELECTION_DATE: mala }), /ELECTION_DATE/, mala);
  }
});

test('la configuración rechaza secretos ausentes, de ejemplo o cortos', () => {
  const ok = {
    SESSION_SECRET: 'a'.repeat(32),
    PIN_HMAC_SECRET: 'b'.repeat(32),
    ADMIN_USER: 'admin',
    ADMIN_PASSWORD_INITIAL: 'una-contraseña-larga',
  };
  assert.equal(cargarConfig(ok).adminUser, 'admin');
  assert.throws(() => cargarConfig({}), (err) =>
    ['SESSION_SECRET', 'PIN_HMAC_SECRET', 'ADMIN_USER', 'ADMIN_PASSWORD_INITIAL'].every((n) => err.message.includes(n))
  );
  assert.throws(() => cargarConfig({ ...ok, SESSION_SECRET: 'cambiame' }), /SESSION_SECRET/);
  assert.throws(() => cargarConfig({ ...ok, PIN_HMAC_SECRET: 'corto' }), /PIN_HMAC_SECRET/);
  assert.throws(() => cargarConfig({ ...ok, ADMIN_PASSWORD_INITIAL: 'corta' }), /ADMIN_PASSWORD_INITIAL/);
});

test('TRUST_PROXY: 2 por defecto, configurable y validado', () => {
  const ok = {
    SESSION_SECRET: 'a'.repeat(32),
    PIN_HMAC_SECRET: 'b'.repeat(32),
    ADMIN_USER: 'admin',
    ADMIN_PASSWORD_INITIAL: 'una-contraseña-larga',
  };
  assert.equal(cargarConfig(ok).trustProxy, 2);
  assert.equal(cargarConfig({ ...ok, TRUST_PROXY: '1' }).trustProxy, 1);
  assert.equal(cargarConfig({ ...ok, TRUST_PROXY: '0' }).trustProxy, 0);
  assert.throws(() => cargarConfig({ ...ok, TRUST_PROXY: 'true' }), /TRUST_PROXY/);
  assert.throws(() => cargarConfig({ ...ok, TRUST_PROXY: '-1' }), /TRUST_PROXY/);
});

test('confiarEnProxy: par inmediato privado y N saltos; nunca confía en un par público', () => {
  assert.equal(confiarEnProxy(0), false);
  for (const ip of ['172.18.0.2', '10.1.2.3', '192.168.1.5', '127.0.0.1', '::1', '::ffff:172.18.0.2', 'fd12::1']) {
    assert.equal(esPrivada(ip), true, ip);
  }
  for (const ip of ['203.0.113.9', '172.32.0.1', '8.8.8.8', '2001:db8::1', 'no-es-ip', '']) {
    assert.equal(esPrivada(ip), false, ip);
  }
  const confia = confiarEnProxy(2);
  assert.equal(confia('172.18.0.2', 0), true);
  assert.equal(confia('172.70.1.1', 1), true);
  assert.equal(confia('203.0.113.9', 2), false);
  assert.equal(confia('203.0.113.50', 0), false, 'un par público directo no es de confianza');
});

test('el PIN tiene 6 dígitos, el HMAC es determinista y no contiene el PIN', () => {
  const db = nuevaDb();
  const { pin, hmac } = generarPin(db, CONFIG.pinHmacSecret);
  assert.match(pin, /^\d{6}$/);
  assert.equal(hmac, hmacPin(CONFIG.pinHmacSecret, pin));
  assert.notEqual(hmac, hmacPin('otro-secreto-distinto-de-32-caracteres', pin));
  assert.ok(!hmac.includes(pin));
});

test('generarPin no devuelve un HMAC ya en uso', () => {
  const db = nuevaDb();
  const insertar = db.prepare('INSERT INTO agente (nombre, pin_hmac, creado_en) VALUES (?, ?, ?)');
  // Ocupa la mitad del espacio de PIN (000000..499999): el generado debe quedar fuera.
  db.transaction(() => {
    for (let n = 0; n < 500_000; n++) {
      insertar.run(`a${n}`, hmacPin(CONFIG.pinHmacSecret, String(n).padStart(6, '0')), 'x');
    }
  })();
  const { pin } = generarPin(db, CONFIG.pinHmacSecret);
  assert.ok(Number(pin) >= 500_000, `el PIN ${pin} ya estaba en uso`);
});
