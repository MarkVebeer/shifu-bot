/**
 * Dashboard pages of every feature, discovered from features/<id>/web.tsx and
 * listed in the order of the registry in features/index.ts.
 */
import { emoji } from '@shifubot/shared';
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { features } from '../../../features';

const pages = import.meta.glob<{ default: ComponentType }>('../../../features/*/web.tsx');

export interface FeaturePage {
  id: string;
  emoji: string;
  Page: LazyExoticComponent<ComponentType>;
}

export const featurePages: FeaturePage[] = features.flatMap((feature) => {
  const loader = pages[`../../../features/${feature.id}/web.tsx`];
  if (!loader) {
    console.warn(`Feature "${feature.id}" has no web.tsx dashboard page`);
    return [];
  }
  return [{ id: feature.id, emoji: emoji[feature.emoji], Page: lazy(loader) }];
});
