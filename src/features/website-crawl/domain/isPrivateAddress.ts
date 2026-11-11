/*** Identify loopback, link-local, and private literal IP addresses. */
export const isPrivateAddress = (address: string): boolean => {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  const mappedIpv4 = /^::ffff:(.+)$/u.exec(normalized)?.[1];
  return (
    isPrivateIpv6(normalized) ||
    isPrivateIpv4(mappedIpv4 ?? normalized) ||
    isPrivateIpv4(normalized)
  );
};

/*** Check private and link-local IPv6 address prefixes. */
const isPrivateIpv6 = (address: string): boolean =>
  address === '::' ||
  address === '::1' ||
  address.startsWith('fc') ||
  address.startsWith('fd') ||
  address.startsWith('fe80:');

/*** Check the private IPv4 ranges that must never be crawler targets. */
const isPrivateIpv4 = (address: string): boolean => {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  )
    return false;
  const value = (octets[0] ?? 0) * 256 + (octets[1] ?? 0);
  return privateIpv4Ranges.some(([start, end]) => value >= start && value <= end);
};

const privateIpv4Ranges = [
  [0, 255],
  [10 * 256, 10 * 256 + 255],
  [100 * 256 + 64, 100 * 256 + 127],
  [127 * 256, 127 * 256 + 255],
  [169 * 256 + 254, 169 * 256 + 254],
  [172 * 256 + 16, 172 * 256 + 31],
  [192 * 256 + 168, 192 * 256 + 168],
] as const;
