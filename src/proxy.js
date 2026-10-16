import { BlockList, isIP } from 'node:net';

const privadas = new BlockList();
privadas.addSubnet('127.0.0.0', 8, 'ipv4');
privadas.addSubnet('10.0.0.0', 8, 'ipv4');
privadas.addSubnet('172.16.0.0', 12, 'ipv4');
privadas.addSubnet('192.168.0.0', 16, 'ipv4');
privadas.addAddress('::1', 'ipv6');
privadas.addSubnet('fc00::', 7, 'ipv6');

export function esPrivada(direccion) {
  const familia = isIP(direccion);
  if (!familia) return false;
  return privadas.check(direccion, familia === 6 ? 'ipv6' : 'ipv4');
}

// Función `trustProxy` para Fastify. Fastify trata un número como "no confiar en nadie", así que
// se confía en `saltos` direcciones de la cadena, exigiendo que el par inmediato (el proxy que
// conecta con la app) sea una IP privada: un cliente que llegue directo desde Internet no puede
// falsear X-Forwarded-For. Con 0 saltos se ignoran las cabeceras X-Forwarded-*.
export function confiarEnProxy(saltos) {
  if (!(saltos > 0)) return false;
  return (direccion, indice) => {
    if (indice >= saltos) return false;
    return indice === 0 ? esPrivada(direccion) : true;
  };
}
