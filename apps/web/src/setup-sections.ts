/**
 * Every setup section in wizard order: core sections first, then the optional
 * features/<id>/setup.tsx of each feature in registry order.
 */
import { features } from '../../../features';
import type { AnySetupSection } from './lib/setup';
import { languageSection } from './setup/language-section';

const featureSetups = import.meta.glob<{ default: AnySetupSection }>('../../../features/*/setup.tsx', { eager: true });

export const setupSections: AnySetupSection[] = [
  languageSection,
  ...features.flatMap((feature) => {
    const module = featureSetups[`../../../features/${feature.id}/setup.tsx`];
    return module ? [module.default] : [];
  }),
];
