export type { VaultConfig } from './config';
export { connectVault, verifyMount, type VaultSession } from './session';
export {
  initIdentity,
  changePassword,
  exportIdentity,
  importIdentity,
  ERR_IDENTITY_MISMATCH,
  type RotationCompleter,
} from './identity';
export { App } from './app';
export { rotateKey, completeInterruptedRotation, rotationCompleter } from './rotation';
export { loadOrganization, saveOrganization } from './organization';
