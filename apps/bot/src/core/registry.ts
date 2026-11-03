import { features } from '../../../../features';
import type { ServerFeature } from './feature';

/**
 * Load the server half (features/<id>/server.ts) of every feature listed in the
 * registry at features/index.ts.
 */
export async function loadServerFeatures(): Promise<ServerFeature[]> {
  return Promise.all(
    features.map(async (manifest) => {
      const module = (await import(`../../../../features/${manifest.id}/server.ts`)) as { default?: ServerFeature };
      const feature = module.default;
      if (!feature || feature.manifest.id !== manifest.id) {
        throw new Error(`features/${manifest.id}/server.ts must default export defineServerFeature({ manifest, ... })`);
      }
      return feature;
    }),
  );
}
