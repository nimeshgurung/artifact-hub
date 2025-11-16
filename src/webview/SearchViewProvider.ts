import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { SearchService } from '../services/SearchService';
import type { ArtifactService } from '../services/ArtifactService';
import type { HttpClient } from '../services/HttpClient';
import type { AuthService } from '../services/AuthService';
import type { WebviewMessage } from './common/ipc';
import { Configuration } from '../config/configuration';
import { PreviewPanelProvider } from './PreviewPanelProvider';

export class SearchViewProvider implements vscode.WebviewViewProvider {
  private previewPanel: PreviewPanelProvider;
  private webviewView?: vscode.WebviewView;

  constructor(
    private context: vscode.ExtensionContext,
    private searchService: SearchService,
    private artifactService: ArtifactService,
    private http: HttpClient,
    private authService: AuthService,
    private config: Configuration,
    private onStateChanged?: () => void | Promise<void>
  ) {
    this.previewPanel = new PreviewPanelProvider(context, artifactService, config, async () => {
      this.refreshSearch();
      await this.onStateChanged?.();
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
      }
    });
  }

  public refreshSearch() {
    if (this.webviewView) {
      // Trigger a refresh by posting tags update
      const tags = this.searchService.getAllTags();
      this.webviewView.webview.postMessage({ type: 'tags', tags });
      this.webviewView.webview.postMessage({ type: 'catalogsUpdated' });
    }
  }

  private async handleMessage(message: WebviewMessage, webview: vscode.Webview): Promise<void> {
    switch (message.type) {
      case 'search': {
        const result = this.searchService.search(message.query);
        webview.postMessage({ type: 'searchResult', result });
        break;
      }

      case 'install': {
        const installRoot = this.config.getInstallRoot();
        const repos = this.config.getRepositories();
        const repoConfig = repos.find(r => r.id === message.artifact.catalogId);

        const result = await this.artifactService.install(
          message.artifact,
          installRoot,
          repoConfig
        );

        webview.postMessage({
          type: 'installResult',
          success: result.success,
          error: result.error
        });

        if (result.success) {
          vscode.window.showInformationMessage(
            `Installed ${message.artifact.name}`,
            'Open File'
          ).then(action => {
            if (action === 'Open File') {
              vscode.workspace.openTextDocument(result.path).then(doc => {
                vscode.window.showTextDocument(doc);
              });
            }
          });
          await this.onStateChanged?.();
        } else {
          vscode.window.showErrorMessage(`Failed to install: ${result.error}`);
        }
        break;
      }

      case 'preview': {
        const artifact = this.searchService.getArtifact(
          message.catalogId,
          message.artifactId
        );

        if (!artifact) {
          throw new Error('Artifact not found');
        }

        const repos = this.config.getRepositories();
        const repoConfig = repos.find(r => r.id === message.catalogId);
        const auth = repoConfig ? await this.authService.resolveAuth(repoConfig.id, repoConfig.auth) : undefined;

        const content = await this.http.fetchText(artifact.sourceUrl, { auth });

        // Open preview in webview panel instead of sidebar
        await this.previewPanel.showPreview(artifact, content);
        break;
      }

      case 'getTags': {
        const tags = this.searchService.getAllTags();
        webview.postMessage({ type: 'tags', tags });
        break;
      }

      case 'uninstall': {
        try {
          await this.artifactService.uninstall(message.catalogId, message.artifactId);
          webview.postMessage({ type: 'uninstallResult', success: true });
          await this.onStateChanged?.();
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Unknown error';
          webview.postMessage({ type: 'uninstallResult', success: false, error });
        }
        break;
      }

      case 'openAddRepository': {
        try {
          await vscode.commands.executeCommand('artifact-hub.addRepository');
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Failed to open repository dialog';
          webview.postMessage({ type: 'error', message: error });
        }
        break;
      }
    }
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const htmlPath = path.join(this.context.extensionPath, 'media', 'search.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview', 'index.js'))
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

