import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { ArtifactService } from '../services/ArtifactService';
import type { UpdateService } from '../services/UpdateService';
import type { SearchService } from '../services/SearchService';
import type { HttpClient } from '../services/HttpClient';
import type { AuthService } from '../services/AuthService';
import type { WebviewMessage } from './common/ipc';
import type { InstallationWithUpdate } from '../models/types';
import { Configuration } from '../config/configuration';
import { PreviewPanelProvider } from './PreviewPanelProvider';

export class InstalledViewProvider implements vscode.WebviewViewProvider {
  private webviewView?: vscode.WebviewView;
  private previewPanel: PreviewPanelProvider;

  constructor(
    private context: vscode.ExtensionContext,
    private artifactService: ArtifactService,
    private updateService: UpdateService,
    private config: Configuration,
    private searchService: SearchService,
    private http: HttpClient,
    private authService: AuthService,
    private onInstallationsChanged?: () => void | Promise<void>
  ) {
    this.previewPanel = new PreviewPanelProvider(context, artifactService, config, async () => {
      await this.refreshInstalled();
      await this.onInstallationsChanged?.();
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    this.webviewView = webviewView;

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

  public async refreshInstalled() {
    if (this.webviewView) {
      const configs = this.config.getRepositories();
      const updates = await this.updateService.checkForUpdates(configs);
      const artifacts = this.updateService.getInstallationsWithUpdates(updates);
      this.webviewView.webview.postMessage({ type: 'installedArtifacts', artifacts });
    }
  }

  private async handleMessage(message: WebviewMessage, webview: vscode.Webview): Promise<void> {
    switch (message.type) {
      case 'getInstalled': {
        const configs = this.config.getRepositories();
        const updates = await this.updateService.checkForUpdates(configs);
        const artifacts = this.updateService.getInstallationsWithUpdates(updates);

        webview.postMessage({ type: 'installedArtifacts', artifacts });
        break;
      }

      case 'uninstall': {
        await this.artifactService.uninstall(message.catalogId, message.artifactId);

        // Refresh list
        const configs = this.config.getRepositories();
        const updates = await this.updateService.checkForUpdates(configs);
        const artifacts = this.updateService.getInstallationsWithUpdates(updates);
        webview.postMessage({ type: 'installedArtifacts', artifacts });
        await this.onInstallationsChanged?.();
        break;
      }

      case 'update': {
        const installRoot = this.config.getInstallRoot();
        const repos = this.config.getRepositories();
        const repoConfig = repos.find(r => r.id === message.catalogId);

        const result = await this.artifactService.update(
          message.catalogId,
          message.artifactId,
          installRoot,
          repoConfig
        );

        if (result.success) {
          vscode.window.showInformationMessage(`Updated ${message.artifactId}`);
        } else {
          vscode.window.showErrorMessage(`Failed to update: ${result.error}`);
        }

        // Refresh list
        const configs = this.config.getRepositories();
        const updates = await this.updateService.checkForUpdates(configs);
        const artifacts = this.updateService.getInstallationsWithUpdates(updates);
        webview.postMessage({ type: 'installedArtifacts', artifacts });
        await this.onInstallationsChanged?.();
        break;
      }

      case 'preview': {
        await this.handlePreview(message.catalogId, message.artifactId);
        break;
      }

      case 'showInstallationDetails': {
        this.showInstallationDetails(message.installation);
        break;
      }
    }
  }

  private async handlePreview(catalogId: string, artifactId: string): Promise<void> {
    const artifact = this.searchService.getArtifact(catalogId, artifactId);
    if (!artifact) {
      vscode.window.showErrorMessage('Artifact not found.');
      return;
    }

    const repos = this.config.getRepositories();
    const repoConfig = repos.find(r => r.id === catalogId);
    const auth = repoConfig ? await this.authService.resolveAuth(repoConfig.id, repoConfig.auth) : undefined;

    try {
      const content = await this.http.fetchText(artifact.sourceUrl, { auth });
      await this.previewPanel.showPreview(artifact, content);
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to load artifact content';
      vscode.window.showErrorMessage(error);
    }
  }

  private async showInstallationDetails(installation: InstallationWithUpdate): Promise<void> {
    const artifactName = installation.artifact?.name ?? installation.artifactId;
    const catalogLine = `Catalog: ${installation.catalogId}`;
    const versionLine = installation.newVersion
      ? `Version: ${installation.version} → ${installation.newVersion}`
      : `Version: ${installation.version}`;
    const pathLine = `Path: ${installation.installedPath}`;
    const installedLine = `Installed: ${this.formatDateTime(installation.installedAt)}`;
    const lastUsedLine = `Last used: ${installation.lastUsed ? this.formatDateTime(installation.lastUsed) : 'Never'}`;

    const detail = [catalogLine, versionLine, pathLine, installedLine, lastUsedLine].join('\n');

    const action = await vscode.window.showInformationMessage(
      artifactName,
      { modal: true, detail },
      'Copy Path'
    );

    if (action === 'Copy Path') {
      await vscode.env.clipboard.writeText(installation.installedPath);
      vscode.window.showInformationMessage('Path copied to clipboard');
    }
  }

  private formatDateTime(value: unknown): string {
    const date = this.toDate(value);
    return date ? date.toLocaleString() : 'Unknown';
  }

  private toDate(value: unknown): Date | null {
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const htmlPath = path.join(this.context.extensionPath, 'media', 'installed.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview', 'installed.js'))
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

