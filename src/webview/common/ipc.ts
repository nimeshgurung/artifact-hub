import type {
  SearchQuery,
  SearchResult,
  ArtifactWithSource,
  CatalogRecord,
  InstallationWithUpdate,
  CatalogRepoConfig,
} from '../../models/types';

// Messages from Webview to Extension
export type WebviewMessage =
  | { type: 'search'; query: SearchQuery }
  | { type: 'install'; artifact: ArtifactWithSource }
  | { type: 'uninstall'; catalogId: string; artifactId: string }
  | { type: 'update'; catalogId: string; artifactId: string }
  | { type: 'preview'; catalogId: string; artifactId: string }
  | { type: 'getInstalled' }
  | { type: 'showInstallationDetails'; installation: InstallationWithUpdate }
  | { type: 'getCatalogs' }
  | { type: 'addCatalog'; config: CatalogRepoConfig }
  | { type: 'removeCatalog'; catalogId: string }
  | { type: 'refreshCatalog'; catalogId: string }
  | { type: 'refreshAllCatalogs' }
  | { type: 'toggleCatalog'; catalogId: string; enabled: boolean }
  | { type: 'testConnection'; url: string; auth?: any }
  | { type: 'getTags' }
  | { type: 'openAddRepository' };

// Messages from Extension to Webview
export type ExtensionMessage =
  | { type: 'searchResult'; result: SearchResult }
  | { type: 'installResult'; success: boolean; error?: string }
  | { type: 'uninstallResult'; success: boolean; error?: string }
  | { type: 'installedArtifacts'; artifacts: InstallationWithUpdate[] }
  | { type: 'catalogs'; catalogs: CatalogRecord[] }
  | { type: 'catalogAdded'; catalog: CatalogRecord }
  | { type: 'catalogRemoved'; catalogId: string }
  | { type: 'catalogUpdated'; catalog: CatalogRecord }
  | { type: 'catalogsUpdated' }
  | { type: 'previewContent'; content: string; artifact: ArtifactWithSource }
  | { type: 'connectionTest'; success: boolean; error?: string }
  | { type: 'categories'; categories: string[] }
  | { type: 'tags'; tags: string[] }
  | { type: 'error'; message: string };

