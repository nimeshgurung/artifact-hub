import * as vscode from 'vscode';
import * as path from 'path';
import type { ArtifactWithSource } from '../models/types';
import type { ArtifactService } from '../services/ArtifactService';
import { Configuration } from '../config/configuration';

interface PreviewMessage {
  type: 'install' | 'uninstall' | 'close';
}

export class PreviewPanelProvider {
  private static currentPanel: vscode.WebviewPanel | undefined;
  private static currentArtifact: ArtifactWithSource | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private artifactService: ArtifactService,
    private config: Configuration,
    private onStateChanged?: () => void | Promise<void>
  ) {}

  public async showPreview(artifact: ArtifactWithSource, content: string) {
    const isInstalled = !!this.artifactService.getInstallation(artifact.catalogId, artifact.id);
    const columnToShowIn = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    PreviewPanelProvider.currentArtifact = artifact;

    if (PreviewPanelProvider.currentPanel) {
      // If panel exists, reveal it and update content
      PreviewPanelProvider.currentPanel.reveal(columnToShowIn);
      PreviewPanelProvider.currentPanel.title = artifact.name;
      this.updateContent(PreviewPanelProvider.currentPanel.webview, artifact, content, isInstalled);
    } else {
      // Create new panel
      PreviewPanelProvider.currentPanel = vscode.window.createWebviewPanel(
        'artifactPreview',
        artifact.name,
        columnToShowIn || vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
          ]
        }
      );

      // Set initial content
      this.updateContent(PreviewPanelProvider.currentPanel.webview, artifact, content, isInstalled);

      // Handle messages from the webview
      PreviewPanelProvider.currentPanel.webview.onDidReceiveMessage(
        async (message: PreviewMessage) => {
          await this.handleMessage(message);
        },
        undefined,
        this.context.subscriptions
      );

      // Reset when panel is closed
      PreviewPanelProvider.currentPanel.onDidDispose(
        () => {
          PreviewPanelProvider.currentPanel = undefined;
          PreviewPanelProvider.currentArtifact = undefined;
        },
        undefined,
        this.context.subscriptions
      );
    }
  }

  private async handleMessage(message: PreviewMessage) {
    if (!PreviewPanelProvider.currentArtifact || !PreviewPanelProvider.currentPanel) {
      return;
    }

    const artifact = PreviewPanelProvider.currentArtifact;
    const panel = PreviewPanelProvider.currentPanel;

    switch (message.type) {
      case 'install': {
        const installRoot = this.config.getInstallRoot();
        const repos = this.config.getRepositories();
        const repoConfig = repos.find(r => r.id === artifact.catalogId);

        const result = await this.artifactService.install(
          artifact,
          installRoot,
          repoConfig
        );

        if (result.success) {
          vscode.window.showInformationMessage(
            `Installed ${artifact.name}`,
            'Open File'
          ).then(action => {
            if (action === 'Open File') {
              vscode.workspace.openTextDocument(result.path).then(doc => {
                vscode.window.showTextDocument(doc);
              });
            }
          });

          await this.onStateChanged?.();
          // Close the preview panel after successful install
          panel.dispose();
        } else {
          vscode.window.showErrorMessage(`Failed to install: ${result.error}`);
        }
        break;
      }

      case 'uninstall': {
        try {
          await this.artifactService.uninstall(artifact.catalogId, artifact.id);
          vscode.window.showInformationMessage(`Uninstalled ${artifact.name}`);

          await this.onStateChanged?.();
          // Close the preview panel after successful uninstall
          panel.dispose();
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Unknown error';
          vscode.window.showErrorMessage(`Failed to uninstall: ${error}`);
        }
        break;
      }

      case 'close': {
        panel.dispose();
        break;
      }
    }
  }

  private updateContent(
    webview: vscode.Webview,
    artifact: ArtifactWithSource,
    content: string,
    installed: boolean
  ) {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'preview.css'))
    );

    webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline';">
  <link rel="stylesheet" href="${cssUri}">
  <title>${this.escapeHtml(artifact.name)}</title>
</head>
<body>
  <div class="preview-container">
    <header class="preview-header">
      <h1>${this.escapeHtml(artifact.name)}</h1>
      <button class="btn-close" onclick="closePreview()">✕</button>
    </header>

    <div class="preview-content">
      <div class="preview-action-bar">
        <button class="${installed ? 'btn-danger' : 'btn-primary'}" onclick="${installed ? 'uninstallArtifact()' : 'installArtifact()'}">
          ${installed ? 'Uninstall' : 'Install'}
        </button>
      </div>

      <div class="preview-main-content">
        <pre><code>${this.escapeHtml(content)}</code></pre>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function installArtifact() {
      vscode.postMessage({ type: 'install' });
    }

    function uninstallArtifact() {
      vscode.postMessage({ type: 'uninstall' });
    }

    function closePreview() {
      vscode.postMessage({ type: 'close' });
    }
  </script>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

