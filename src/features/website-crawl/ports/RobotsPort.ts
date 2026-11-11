export interface RobotsPort {
  readonly isAllowedAsync: (url: string) => Promise<boolean>;
}
