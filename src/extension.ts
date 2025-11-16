import * as vscode from 'vscode';
import { DatabaseService } from './storage/Database';
import { Configuration } from './config/configuration';
import { HttpClient } from './services/HttpClient';
import { UrlResolver } from './services/UrlResolver';
import { AuthService } from './services/AuthService';
import { CatalogService } from './services/CatalogService';
import { SearchService } from './services/SearchService';
import { ArtifactService } from './services/ArtifactService';
import { UpdateService } from './services/UpdateService';
import { StatusBarService } from './services/StatusBarService';
// import { ProfileService } from './services/ProfileService'; // Reserved for future use
import { SearchViewProvider } from './webview/SearchViewProvider';
import { InstalledViewProvider } from './webview/InstalledViewProvider';
import { RepositoriesViewProvider } from './webview/RepositoriesViewProvider';

let refreshInterval: NodeJS.Timeout | null = null;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Artifact Hub extension activating...');

  // Initialize services
  const config = new Configuration();
  const db = new DatabaseService(context);
  await db.initialize();

  const http = new HttpClient();
  const urlResolver = new UrlResolver();
  const authService = new AuthService(context);
  const catalogService = new CatalogService(db, http, urlResolver, authService);
  const searchService = new SearchService(db);
  const artifactService = new ArtifactService(db, http, authService, searchService);
  const updateService = new UpdateService(db, searchService, http, authService);
  const statusBarService = new StatusBarService();
  // ProfileService available for future use
  // const profileService = new ProfileService(artifactService, searchService);

  const refreshInstalledAndStatus = async () => {
    await installedViewProvider?.refreshInstalled();
    await updateStatusBar();
  };

  const refreshSearchAndStatus = async () => {
    searchViewProvider?.refreshSearch();
    await updateStatusBar();
  };

  const refreshAllViews = async () => {
    searchViewProvider?.refreshSearch();
    await installedViewProvider?.refreshInstalled();
    await updateStatusBar();
  };

  // Register webview providers
  const searchViewProvider = new SearchViewProvider(
    context,
    searchService,
    artifactService,
    http,
    authService,
    config,
    refreshInstalledAndStatus
  );

  const installedViewProvider = new InstalledViewProvider(
    context,
    artifactService,
    updateService,
    config,
    searchService,
    http,
    authService,
    refreshSearchAndStatus
  );

  const repositoriesViewProvider = new RepositoriesViewProvider(
    context,
    catalogService,
    config,
    refreshAllViews
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('artifact-hub.search', searchViewProvider),
    vscode.window.registerWebviewViewProvider('artifact-hub.installed', installedViewProvider),
    vscode.window.registerWebviewViewProvider('artifact-hub.repositories', repositoriesViewProvider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('artifact-hub.search', () => {
      vscode.commands.executeCommand('artifact-hub.search.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('artifact-hub.addRepository', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'Enter catalog URL',
        placeHolder: 'https://gitlab.com/org/repo/-/raw/main/copilot-catalog.json',
        validateInput: (value) => {
          try {
            new URL(value);
            return null;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      });

      if (!url) return;

      const id = await vscode.window.showInputBox({
        prompt: 'Enter catalog ID',
        value: generateIdFromUrl(url),
        validateInput: (value) => {
          if (!/^[a-z0-9-]+$/.test(value)) {
            return 'ID can only contain lowercase letters, numbers, and hyphens';
          }
          return null;
        },
      });

      if (!id) return;

      const requiresAuth = await vscode.window.showQuickPick(['No', 'Yes'], {
        placeHolder: 'Does this repository require authentication?',
      });

      try {
        const catalogConfig = {
          id,
          url,
          enabled: true,
          auth: requiresAuth === 'Yes' ? { type: 'bearer' as const } : undefined,
        };

        if (requiresAuth === 'Yes') {
          await authService.promptForToken(id, id);
        }

        await catalogService.addCatalog(catalogConfig);

        const repos = config.getRepositories();
        await config.setRepositories([...repos, catalogConfig]);

        // Refresh search view to show new catalog artifacts
        searchViewProvider.refreshSearch();

        vscode.window.showInformationMessage(`Added catalog: ${id}`);
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to add catalog: ${error}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('artifact-hub.removeRepository', async () => {
      const configs = config.getRepositories();

      if (configs.length === 0) {
        vscode.window.showInformationMessage('No repositories configured');
        return;
      }

      const items = configs.map(c => ({
        label: c.id,
        description: c.url,
        detail: catalogService.getCatalog(c.id)?.metadata.description || '',
        catalogId: c.id
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select repository to remove',
        matchOnDescription: true,
        matchOnDetail: true
      });

      if (!selected) return;

      try {
        await catalogService.removeCatalog(selected.catalogId);

        const updatedConfigs = configs.filter(c => c.id !== selected.catalogId);
        await config.setRepositories(updatedConfigs);

        // Refresh views
        await refreshAllViews();

        vscode.window.showInformationMessage(`Removed repository: ${selected.catalogId}`);
      } catch (err) {
        // Error already handled in service (user cancellation or actual error)
        if (err instanceof Error && !err.message.includes('not found')) {
          console.error('Failed to remove repository:', err);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('artifact-hub.refreshCatalogs', async () => {
      const configs = config.getRepositories();
      await catalogService.refreshAll(configs);

      // Refresh search view to show updated catalog artifacts
      searchViewProvider.refreshSearch();

      vscode.window.showInformationMessage('Catalogs refreshed');

      updateStatusBar();
    })
  );

  // Update status bar
  async function updateStatusBar() {
    const installations = artifactService.getAllInstallations();
    const configs = config.getRepositories();
    const updates = await updateService.checkForUpdates(configs);

    statusBarService.setArtifactCount(installations.length);
    statusBarService.setUpdateCount(updates.length);
  }

  // Initial status bar update
  updateStatusBar();

  // Setup auto-refresh
  if (config.getAutoUpdate()) {
    const interval = config.getUpdateInterval() * 1000;
    refreshInterval = setInterval(async () => {
      const configs = config.getRepositories();
      await catalogService.refreshAll(configs);
      updateStatusBar();
    }, interval);

    context.subscriptions.push(
      new vscode.Disposable(() => {
        if (refreshInterval) {
          clearInterval(refreshInterval);
        }
      })
    );
  }

  // Cleanup
  context.subscriptions.push(statusBarService);
  context.subscriptions.push(
    new vscode.Disposable(() => {
      db.close();
    })
  );

  console.log('Artifact Hub extension activated');
}

export function deactivate() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
}

function generateIdFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const parts = urlObj.pathname.split('/').filter(p => p.length > 0);
    return parts.slice(-3, -1).join('-').toLowerCase();
  } catch {
    return 'custom-catalog';
  }
}

