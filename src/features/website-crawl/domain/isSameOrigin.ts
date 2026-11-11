/*** Check whether a discovered link remains inside the original website boundary. */
export const isSameOrigin = (candidate: string, origin: string): boolean =>
  new URL(candidate).origin === origin;
