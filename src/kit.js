import { readFileSync } from 'node:fs';
import path from 'node:path';
import { raiz } from './version.js';

// Kit del agente electoral: contenido (checklist y guía) en content/*.json, editable sin tocar código.
// Se valida al arrancar (un archivo mal formado impide el arranque con un mensaje claro) y se filtra en
// el servidor según el rol: los puntos pendientes de verificar solo los ve el administrador.

export const MARCA_VERIFICAR = '[VERIFICAR]';
export const ROLES_SOLO = { apoderado: 'Solo apoderado', interventor: 'Solo interventor' };
const MAX_TEXTO = 500;
const MAX_TITULO = 80;
const ID_VALIDO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const directorioContenido = (config) => config?.contentDir ?? path.join(raiz, 'content');

function leerJson(archivo) {
  let bruto;
  try {
    bruto = readFileSync(archivo, 'utf8');
  } catch {
    throw new Error(`Contenido del kit: no se puede leer ${archivo}.`);
  }
  try {
    return JSON.parse(bruto);
  } catch (err) {
    throw new Error(`Contenido del kit: ${archivo} no es un JSON válido (${err.message}).`);
  }
}

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function soloClaves(obj, permitidas, donde, errores) {
  for (const k of Object.keys(obj)) if (!permitidas.includes(k)) errores.push(`${donde}: clave desconocida «${k}».`);
}

function validarTexto(valor, donde, max, errores) {
  if (typeof valor !== 'string' || valor.trim() === '') {
    errores.push(`${donde}: debe ser un texto no vacío.`);
    return false;
  }
  if (valor.length > max) errores.push(`${donde}: supera los ${max} caracteres.`);
  return true;
}

function validarId(valor, donde, vistos, errores) {
  if (typeof valor !== 'string' || !ID_VALIDO.test(valor)) {
    errores.push(`${donde}: el identificador debe ser minúsculas, números y guiones (p. ej. «abrir-mesa»).`);
    return;
  }
  if (vistos.has(valor)) errores.push(`${donde}: el identificador «${valor}» está repetido.`);
  vistos.add(valor);
}

// Un punto con la marca en el texto DEBE llevar "verificar": true (y al revés): así un descuido en el
// archivo nunca deja pasar a un agente un texto pendiente de verificar.
function validarPunto(p, donde, { conId, vistos }, errores) {
  if (!esObjeto(p)) {
    errores.push(`${donde}: cada punto debe ser un objeto.`);
    return;
  }
  soloClaves(p, conId ? ['id', 'texto', 'solo', 'verificar'] : ['texto', 'solo', 'verificar'], donde, errores);
  if (conId) validarId(p.id, donde, vistos, errores);
  const textoValido = validarTexto(p.texto, `${donde}.texto`, MAX_TEXTO, errores);
  if (p.solo !== undefined && !Object.hasOwn(ROLES_SOLO, p.solo)) {
    errores.push(`${donde}.solo: debe ser «apoderado» o «interventor».`);
  }
  if (p.verificar !== undefined && typeof p.verificar !== 'boolean') errores.push(`${donde}.verificar: debe ser true o false.`);
  if (textoValido) {
    const marcado = p.texto.includes(MARCA_VERIFICAR);
    if (marcado && p.verificar !== true) errores.push(`${donde}: el texto lleva ${MARCA_VERIFICAR} pero falta "verificar": true.`);
    if (!marcado && p.verificar === true) errores.push(`${donde}: tiene "verificar": true pero el texto no lleva ${MARCA_VERIFICAR}.`);
  }
}

function validarGrupos(lista, nombre, { conIdPunto, intro }) {
  const errores = [];
  if (!Array.isArray(lista) || lista.length === 0) {
    errores.push(`${nombre}: debe haber al menos un elemento.`);
    return { errores, grupos: [] };
  }
  const idsGrupo = new Set();
  const idsPunto = new Set();
  lista.forEach((g, i) => {
    const donde = `${nombre}[${i + 1}]`;
    if (!esObjeto(g)) {
      errores.push(`${donde}: debe ser un objeto.`);
      return;
    }
    soloClaves(g, intro ? ['id', 'titulo', 'intro', 'puntos'] : ['id', 'titulo', 'puntos'], donde, errores);
    validarId(g.id, donde, idsGrupo, errores);
    validarTexto(g.titulo, `${donde}.titulo`, MAX_TITULO, errores);
    if (intro && g.intro !== undefined) validarTexto(g.intro, `${donde}.intro`, MAX_TEXTO, errores);
    if (!Array.isArray(g.puntos) || g.puntos.length === 0) {
      errores.push(`${donde}.puntos: debe haber al menos un punto.`);
      return;
    }
    g.puntos.forEach((p, j) => validarPunto(p, `${donde}.puntos[${j + 1}]`, { conId: conIdPunto, vistos: idsPunto }, errores));
  });
  return { errores, grupos: lista };
}

// Valida el contenido ya leído; devuelve la lista de errores (vacía si todo está bien).
export function validarContenido({ checklist, guia }) {
  const errores = [];
  if (!esObjeto(checklist)) errores.push('checklist.json: debe ser un objeto con "fases".');
  else {
    soloClaves(checklist, ['fases'], 'checklist.json', errores);
    errores.push(...validarGrupos(checklist.fases, 'checklist.json fases', { conIdPunto: true, intro: false }).errores);
  }
  if (!esObjeto(guia)) errores.push('guia.json: debe ser un objeto con "secciones".');
  else {
    soloClaves(guia, ['secciones'], 'guia.json', errores);
    errores.push(...validarGrupos(guia.secciones, 'guia.json secciones', { conIdPunto: false, intro: true }).errores);
  }
  return errores;
}

export function cargarKit(directorio) {
  const checklist = leerJson(path.join(directorio, 'checklist.json'));
  const guia = leerJson(path.join(directorio, 'guia.json'));
  const errores = validarContenido({ checklist, guia });
  if (errores.length) {
    throw new Error(`Contenido del kit no válido (${directorio}):\n - ${errores.join('\n - ')}`);
  }
  return {
    fases: checklist.fases.map((f) => ({ id: f.id, titulo: f.titulo, puntos: f.puntos.map(normalizarPunto) })),
    secciones: guia.secciones.map((s) => ({ id: s.id, titulo: s.titulo, intro: s.intro ?? null, puntos: s.puntos.map(normalizarPunto) })),
  };
}

const normalizarPunto = (p) => ({ id: p.id ?? null, texto: p.texto, solo: p.solo ?? null, verificar: p.verificar === true });

// Filtro del servidor: un agente NO recibe los puntos pendientes de verificar (ni siquiera ocultos en
// el HTML); el administrador los recibe etiquetados. Se descartan las fases y secciones que se quedan vacías.
export function kitParaRol(kit, esAdmin) {
  const visibles = (puntos) => (esAdmin ? puntos : puntos.filter((p) => !p.verificar));
  const conPuntos = (g) => ({ ...g, puntos: visibles(g.puntos) });
  return {
    fases: kit.fases.map(conPuntos).filter((f) => f.puntos.length > 0),
    secciones: kit.secciones.map(conPuntos).filter((s) => s.puntos.length > 0),
  };
}
