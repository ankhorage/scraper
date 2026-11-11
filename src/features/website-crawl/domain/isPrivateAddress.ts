/*** Identify loopback, link-local, and private literal IP addresses. */
export const isPrivateAddress = (address: string): boolean => {
  const normalized = address.toLowerCase();
  return isPrivateIpv6(normalized) || isPrivateIpv4(normalized);
};

/*** Check private and link-local IPv6 address prefixes. */
const isPrivateIpv6 = (address: string): boolean =>
  address === '::1' ||
  address.startsWith('fc') ||
  address.startsWith('fd') ||
  address.startsWith('fe80:');

/*** Check the private IPv4 ranges that must never be crawler targets. */
const isPrivateIpv4 = (address: string): boolean => {
  const [first, second] = address.split('.').map(Number);
  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
};
