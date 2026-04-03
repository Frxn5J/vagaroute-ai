import { states } from './pool';
import { listActiveCustomMediaModels } from './customProviders';
import type { ModelAliasCategory } from './db';

export const MODEL_ALIAS_CATEGORIES: ModelAliasCategory[] = ['chat', 'images', 'imageEdit', 'videos'];

const IMAGE_TARGETS = [
  'flux',
  'sdxl',
  'turbo',
  'playground',
  'illustrious',
  'qwen-image',
  'wan',
  'imagegeneration',
  'qwenimage',
];

const IMAGE_EDIT_TARGETS = [
  'qwen-image-edit',
];

const VIDEO_TARGETS = [
  'qwen-video',
];

export function getModelAliasCategoryLabel(category: ModelAliasCategory): string {
  switch (category) {
    case 'images':
      return 'Generación de imágenes';
    case 'imageEdit':
      return 'Edición de imágenes';
    case 'videos':
      return 'Videos';
    default:
      return 'Chat';
  }
}

export function getAvailableAliasTargets(category: ModelAliasCategory): string[] {
  if (category === 'chat') {
    return states.map((state) => state.service.name);
  }
  if (category === 'images') {
    return [...IMAGE_TARGETS, ...listActiveCustomMediaModels('images').map((item) => `${item.providerSlug}/${item.model.id}`)];
  }
  if (category === 'imageEdit') {
    return IMAGE_EDIT_TARGETS;
  }
  return [...VIDEO_TARGETS, ...listActiveCustomMediaModels('videos').map((item) => `${item.providerSlug}/${item.model.id}`)];
}

export function isValidAliasTarget(targetModel: string, category: ModelAliasCategory): boolean {
  return getAvailableAliasTargets(category).includes(targetModel);
}

export function getModelAliasCategories() {
  return MODEL_ALIAS_CATEGORIES.map((category) => ({
    id: category,
    name: getModelAliasCategoryLabel(category),
    targets: getAvailableAliasTargets(category),
  }));
}
