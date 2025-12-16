import { DATA, normalizeDataAdapter } from '../../config.js';
import { resolveAdapter } from './adapters/index.js';

export function createStateStore(options = {}) {
  const adapterName = normalizeDataAdapter(options.adapter || DATA.adapter);
  const adapterFactory = resolveAdapter(adapterName);
  return adapterFactory();
}
