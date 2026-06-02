import type { Profile } from 'passport';

declare global {
  namespace Express {
    interface User extends Profile {
      guilds?: Array<{
        id: string;
        name: string;
        permissions: string;
        icon?: string | null;
      }>;
    }
  }
}

export {};