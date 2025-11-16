import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { CatalogService } from '../services/CatalogService';
import type { WebviewMessage } from './common/ipc';
import { Configuration } from '../config/configuration';

export class RepositoriesViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private context: vscode.ExtensionContext,
    private catalogService: CatalogService,
    private config: Configuration,
    private onCatalogsChanged?: () => void | Promise<void>
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
        vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview')),
      ],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      try {
        await this.handleMessage(message, webviewView.webview);
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        webviewView.webview.postMessage({ type: 'error', message: error });
        vscode.window.showErrorMessage(error);
      }
    });
  }

  private async handleMessage(message: WebviewMessage, webview: vscode.Webview): Promise<void> {
    switch (message.type) {
      case 'getCatalogs': {
        this.postCatalogs(webview);
        break;
      }

      case 'addCatalog': {
        await this.catalogService.addCatalog(message.config);

        const configs = this.config.getRepositories();
        await this.config.setRepositories([...configs, message.config]);

        const catalog = this.catalogService.getCatalog(message.config.id);
        if (catalog) {
          webview.postMessage({ type: 'catalogAdded', catalog });
        }

        await this.notifyCatalogsChanged(webview);
        vscode.window.showInformationMessage(`Added catalog: ${message.config.id}`);
        break;
      }

      case 'removeCatalog': {
        try {
          await this.catalogService.removeCatalog(message.catalogId);

          const configs = this.config.getRepositories();
          await this.config.setRepositories(configs.filter(c => c.id !== message.catalogId));

          webview.postMessage({ type: 'catalogRemoved', catalogId: message.catalogId });
          await this.notifyCatalogsChanged(webview);
          vscode.window.showInformationMessage(`Removed repository: ${message.catalogId}`);
        } catch (err) {
          // User cancelled or error occurred
          if (err instanceof Error && err.message.includes('not found')) {
            webview.postMessage({ type: 'error', message: err.message });
          }
          // Don't show error for user cancellation
        }
        break;
      }

      case 'refreshCatalog': {
        const configs = this.config.getRepositories();
        const config = configs.find(c => c.id === message.catalogId);

        if (config) {
          await this.catalogService.refreshCatalog(message.catalogId, config);
          const catalog = this.catalogService.getCatalog(message.catalogId);

          if (catalog) {
            webview.postMessage({ type: 'catalogUpdated', catalog });
          }

          await this.onCatalogsChanged?.();
          vscode.window.showInformationMessage(`Refreshed catalog: ${message.catalogId}`);
        }
        break;
      }

      case 'refreshAllCatalogs': {
        const configs = this.config.getRepositories();
        await this.catalogService.refreshAll(configs);

        await this.notifyCatalogsChanged(webview);

        vscode.window.showInformationMessage('All catalogs refreshed');
        break;
      }

      case 'toggleCatalog': {
        await this.catalogService.updateCatalog(message.catalogId, {
          enabled: message.enabled,
        });

        const configs = this.config.getRepositories();
        const updatedConfigs = configs.map(c =>
          c.id === message.catalogId ? { ...c, enabled: message.enabled } : c
        );
        await this.config.setRepositories(updatedConfigs);

        const catalog = this.catalogService.getCatalog(message.catalogId);
        if (catalog) {
          webview.postMessage({ type: 'catalogUpdated', catalog });
        }
        await this.onCatalogsChanged?.();
        break;
      }

      case 'openAddRepository': {
        try {
          await vscode.commands.executeCommand('artifact-hub.addRepository');
          await this.notifyCatalogsChanged(webview);
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Failed to open add repository flow';
          webview.postMessage({ type: 'error', message: error });
        }
        break;
      }
    }
  }

  private postCatalogs(webview: vscode.Webview) {
    const catalogs = this.catalogService.getAllCatalogs();
    webview.postMessage({ type: 'catalogs', catalogs });
  }

  private async notifyCatalogsChanged(webview: vscode.Webview) {
    this.postCatalogs(webview);
    await this.onCatalogsChanged?.();
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const htmlPath = path.join(this.context.extensionPath, 'media', 'repositories.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview', 'repositories.js'))
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'styles.css'))
    );

    return htmlContent
      .replace(/{{scriptUri}}/g, scriptUri.toString())
      .replace(/{{cssUri}}/g, cssUri.toString())
      .replace(/{{cspSource}}/g, webview.cspSource);
  }
}

