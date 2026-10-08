import * as ia from './internet-archive.js';
const adapters = { 'internet-archive': ia };
export function getAdapter(type) {
  const a = adapters[type];
  if (!a) throw new Error(`Sumber "${type}" tidak dikenal. Pilihan: ${Object.keys(adapters).join(', ')}`);
  return a;
}
