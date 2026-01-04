import { DATA, normalizeDataAdapter } from '../../config.js';
import { resolveAdapter } from './adapters/index.js';

export function createStateStore(options = {}) {
  const adapterName = normalizeDataAdapter(options.adapter || DATA.adapter);
  const adapterFactory = resolveAdapter(adapterName);
  const adapterOptions = {
    ...options,
    sqliteFile: options.sqliteFile || DATA.sqliteFile,
    kvFile: options.kvFile || DATA.kvFile,
    mysqlUrl: options.mysqlUrl || DATA.mysqlUrl,
    mysqlHost: options.mysqlHost || DATA.mysqlHost,
    mysqlPort: options.mysqlPort ?? DATA.mysqlPort,
    mysqlUser: options.mysqlUser || DATA.mysqlUser,
    mysqlPassword: options.mysqlPassword || DATA.mysqlPassword,
    mysqlDatabase: options.mysqlDatabase || DATA.mysqlDatabase,
    mysqlTable: options.mysqlTable || DATA.mysqlTable,
    mongoUrl: options.mongoUrl || DATA.mongoUrl,
    mongoDb: options.mongoDb || DATA.mongoDb,
    mongoCollection: options.mongoCollection || DATA.mongoCollection,
  };
  return adapterFactory(adapterOptions);
}
