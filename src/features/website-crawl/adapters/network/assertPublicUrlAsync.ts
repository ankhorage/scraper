import { lookup } from 'node:dns/promises';

import { isPrivateAddress } from '../../domain/isPrivateAddress.js';

/*** Reject an HTTP target whose hostname or current DNS answers are not public addresses. */
export const assertPublicUrlAsync = async (input: string): Promise<URL> => {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsafe protocol');
  if (url.hostname === 'localhost' || isPrivateAddress(url.hostname))
    throw new Error('Private host blocked');

  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address)))
    throw new Error('Private address blocked');
  return url;
};
