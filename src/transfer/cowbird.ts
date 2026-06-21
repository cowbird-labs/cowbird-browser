import { encodeExport, decodeExport } from '../items/transfer';
import type { Codec } from './types';

// cowbirdCodec is the native, full-fidelity format. It delegates to the export
// codec in ../items/transfer, which owns the on-disk schema.
export const cowbirdCodec: Codec = {
  id: 'cowbird',
  name: 'Cowbird (JSON)',
  extension: '.json',
  marshal: async (contents) => encodeExport(contents),
  unmarshal: async (data) => decodeExport(data),
};
