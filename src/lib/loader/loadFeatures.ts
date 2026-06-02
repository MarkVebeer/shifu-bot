import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Express } from 'express';
import type { Client } from 'discord.js';
import type { SqliteDatabase } from '../database/types.js';

export interface FeatureContext {
  app: Express;
  client: Client;
  database: SqliteDatabase;
}

export interface FeatureModule {
  name: string;
  register: (context: FeatureContext) => Promise<void> | void;
}

async function resolveFeatureEntry(featureDirectory: string) {
  const candidates = ['index.ts', 'index.js', 'index.mjs'];

  for (const candidate of candidates) {
    const entryPath = path.join(featureDirectory, candidate);
    try {
      await fs.access(entryPath);
      return entryPath;
    } catch {
      continue;
    }
  }

  return null;
}

export async function loadFeatures(context: FeatureContext) {
  const featuresRoot = fileURLToPath(new URL('../../features', import.meta.url));
  const featureDirectories = await fs.readdir(featuresRoot, { withFileTypes: true });

  for (const entry of featureDirectories) {
    if (!entry.isDirectory()) {
      continue;
    }

    const featureDirectory = path.join(featuresRoot, entry.name);
    const featureEntry = await resolveFeatureEntry(featureDirectory);

    if (!featureEntry) {
      continue;
    }

    const moduleUrl = pathToFileURL(featureEntry).href;
    const importedModule = (await import(moduleUrl)) as { default?: FeatureModule };
    const feature = importedModule.default;

    if (!feature) {
      continue;
    }

    await feature.register(context);
    console.log(`Loaded feature: ${feature.name}`);
  }
}
