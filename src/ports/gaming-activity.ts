/** True when a sim / game session should keep the discrete GPU free. */
export interface GamingActivityPort {
  isActive(): Promise<boolean>;
}
