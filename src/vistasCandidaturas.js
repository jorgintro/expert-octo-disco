// Piezas HTML de las candidaturas: insignia (logo o siglas sobre el color corporativo).
// El color de cada candidatura llega por una hoja de estilos (.cand-<id>) porque la CSP no admite estilos en línea.
import { html } from './vistas.js';

export const clase = (c) => `cand-${c.id}`;

// Logo subido o, si no hay, insignia con las siglas (o el nombre) sobre el color corporativo.
export function insignia(c) {
  return c.tiene_logo
    ? html`<span class="marca marca-logo ${clase(c)}"><img src="/logos/${c.id}?v=${c.logo_hash}" alt="" width="44" height="44" loading="lazy"></span>`
    : html`<span class="marca marca-insignia ${clase(c)}" aria-hidden="true">${(c.siglas || c.nombre).slice(0, 4)}</span>`;
}

export const etiquetaCandidatura = (c) => c.siglas || c.nombre;
