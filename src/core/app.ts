import type { Identity } from '../crypto/identity';
import { Service } from '../sharing/service';
import type { VaultSession } from './session';

// Mirrors core.App: an authenticated Vault session, a decrypted identity, and a
// sharing service wired to both.
export class App {
  service: Service;

  constructor(
    public session: VaultSession,
    public identity: Identity,
  ) {
    this.service = new Service(session.entityID, identity, session.store);
  }

  /** adoptIdentity swaps in a new identity (after key rotation) and rebuilds the
   * sharing service so subsequent operations use the new keypair. */
  adoptIdentity(identity: Identity): void {
    this.identity = identity;
    this.service = new Service(this.session.entityID, identity, this.session.store);
  }
}
