import * as vscode from 'vscode';
import * as path from 'path';
import type { DatabaseService } from '../storage/Database';
import type { HttpClient } from './HttpClient';
import type { AuthService } from './AuthService';
import type { SearchService } from './SearchService';
import type {
  ArtifactWithSource,
  Installation,
  ConflictResolution,
  InstallResult,
  CatalogRepoConfig,
  AuthConfig,
} from '../models/types';
import type { InstallationRow } from '../storage/types';
import { ARTIFACT_PATHS, ARTIFACT_EXTENSIONS } from '../config/constants';

export class ArtifactService {
  constructor(
    private db: DatabaseService,
    private http: HttpClient,
    private authService: AuthService,
    private searchService: SearchService
  ) {}

  async install(
    artifact: ArtifactWithSource,
    installRoot: string,
    repoConfig?: CatalogRepoConfig
  ): Promise<InstallResult> {
    try {
      // Check if already installed
      const existing = this.getInstallation(artifact.catalogId, artifact.id);
      if (existing) {
        throw new Error('Artifact already installed. Use update instead.');
      }

      // Resolve dependencies
      const deps = await this.resolveDependencies(artifact);

      // Check for conflicts
      const targetPath = this.getInstallPath(artifact, installRoot);
      const conflict = await this.checkConflict(targetPath);

      if (conflict) {
        const resolution = await this.promptConflictResolution(artifact.name, targetPath);
        if (!resolution) {
          return { success: false, artifact, path: targetPath, error: 'Installation cancelled' };
        }

        if (resolution.action === 'keep') {
          return { success: false, artifact, path: targetPath, error: 'Keeping existing file' };
        } else if (resolution.action === 'rename' && resolution.newName) {
          // Update target path with new name
          const dir = path.dirname(targetPath);
          const ext = path.extname(targetPath);
          const newPath = path.join(dir, resolution.newName + ext);
          return await this.performInstall(artifact, newPath, repoConfig);
        }
        // 'replace' falls through to normal install
      }

      // Install dependencies first
      for (const dep of deps) {
        await this.install(dep, installRoot, repoConfig);
      }

      return await this.performInstall(artifact, targetPath, repoConfig);
    } catch (err) {
      return {
        success: false,
        artifact,
        path: '',
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  async uninstall(catalogId: string, artifactId: string): Promise<void> {
    const installation = this.getInstallation(catalogId, artifactId);
    if (!installation) {
      throw new Error('Artifact not installed');
    }

    // Prompt for confirmation
    const confirm = await vscode.window.showWarningMessage(
      `Delete ${path.basename(installation.installedPath)} and its supporting files?`,
      { modal: true },
      'Delete'
    );

    if (confirm !== 'Delete') {
      return;
    }

    // Delete main file
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(installation.installedPath));
    } catch (err) {
      console.error('Failed to delete main file:', err);
      // Continue anyway to remove supporting files and from DB
    }

    // Delete supporting files directory if it exists
    try {
      const workspaceRoot = this.getWorkspaceRootPath();
      const supportingDir = path.join(workspaceRoot, '.github', `.${artifactId}`);
      await this.deleteDirectoryIfExists(supportingDir);

      // Clean up legacy locations if they exist
      const legacyHiddenDir = path.join(workspaceRoot, `.${artifactId}`);
      await this.deleteDirectoryIfExists(legacyHiddenDir);

      const legacyDir = path.join(path.dirname(installation.installedPath), artifactId);
      await this.deleteDirectoryIfExists(legacyDir);
    } catch (err) {
      console.error('Failed to delete supporting files:', err);
      // Continue to remove from DB
    }

    // Remove from database
    this.db.getDb().prepare(
      'DELETE FROM installations WHERE artifact_id = ? AND catalog_id = ?'
    ).run(artifactId, catalogId);

    vscode.window.showInformationMessage(`Uninstalled ${artifactId}`);
  }

  async update(
    catalogId: string,
    artifactId: string,
    installRoot: string,
    repoConfig?: CatalogRepoConfig
  ): Promise<InstallResult> {
    const installation = this.getInstallation(catalogId, artifactId);
    if (!installation) {
      throw new Error('Artifact not installed');
    }

    // Get latest version
    const artifact = this.searchService.getArtifact(catalogId, artifactId);
    if (!artifact) {
      throw new Error('Artifact not found in catalog');
    }

    // Perform update (same as install but overwrites)
    return await this.performInstall(artifact, installation.installedPath, repoConfig);
  }

  getInstallation(catalogId: string, artifactId: string): Installation | null {
    const row = this.db.getDb().prepare(`
      SELECT id, artifact_id, catalog_id, version, installed_path, installed_at, last_used
      FROM installations
      WHERE catalog_id = ? AND artifact_id = ?
    `).get(catalogId, artifactId) as InstallationRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      artifactId: row.artifact_id,
      catalogId: row.catalog_id,
      version: row.version,
      installedPath: row.installed_path,
      installedAt: new Date(row.installed_at),
      lastUsed: row.last_used ? new Date(row.last_used) : null,
    };
  }

  getAllInstallations(): Installation[] {
    const rows = this.db.getDb().prepare(`
      SELECT id, artifact_id, catalog_id, version, installed_path, installed_at, last_used
      FROM installations
      ORDER BY installed_at DESC
    `).all() as InstallationRow[];

    return rows.map(row => ({
      id: row.id,
      artifactId: row.artifact_id,
      catalogId: row.catalog_id,
      version: row.version,
      installedPath: row.installed_path,
      installedAt: new Date(row.installed_at),
      lastUsed: row.last_used ? new Date(row.last_used) : null,
    }));
  }

  private async performInstall(
    artifact: ArtifactWithSource,
    targetPath: string,
    repoConfig?: CatalogRepoConfig
  ): Promise<InstallResult> {
    const auth = repoConfig ? await this.authService.resolveAuth(repoConfig.id, repoConfig.auth) : undefined;

    // Calculate total files to download
    const totalFiles = 1 + (artifact.supportingFiles?.length || 0);
    let downloadedFiles = 0;

    // Show progress notification
    return await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Installing ${artifact.name}`,
      cancellable: false
    }, async (progress) => {
      try {
        // Download main artifact content
        progress.report({
          increment: 0,
          message: `Downloading main file (1/${totalFiles})...`
        });
        const content = await this.http.fetchText(artifact.sourceUrl, { auth });

        // Ensure directory exists
        const dir = path.dirname(targetPath);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));

        // Write main file
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(targetPath),
          Buffer.from(content, 'utf-8')
        );
        downloadedFiles++;
        progress.report({
          increment: (1 / totalFiles) * 100,
          message: `Downloaded ${downloadedFiles}/${totalFiles}`
        });

        // Download and install supporting files
        if (artifact.supportingFiles && artifact.supportingFiles.length > 0) {
          await this.installSupportingFiles(
            artifact,
            targetPath,
            auth,
            progress,
            totalFiles,
            downloadedFiles
          );
        }

        // Record installation
        this.db.getDb().prepare(`
          INSERT OR REPLACE INTO installations (artifact_id, catalog_id, version, installed_path, installed_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(artifact.id, artifact.catalogId, artifact.version, targetPath);

        return {
          success: true,
          artifact,
          path: targetPath,
        };
      } catch (err) {
        return {
          success: false,
          artifact,
          path: targetPath,
          error: err instanceof Error ? err.message : 'Unknown error during installation',
        };
      }
    });
  }

  private async installSupportingFiles(
    artifact: ArtifactWithSource,
    mainFilePath: string,
    auth: AuthConfig | undefined,
    progress: vscode.Progress<{ increment?: number; message?: string }>,
    totalFiles: number,
    startCount: number
  ): Promise<void> {
    if (!artifact.supportingFiles || artifact.supportingFiles.length === 0) {
      return;
    }

    // Get the catalog base URL from the artifact source URL
    const catalogBaseUrl = this.getCatalogBaseUrl(artifact.sourceUrl, artifact.path);

    const workspaceRoot = this.getWorkspaceRootPath();
    const supportingDir = path.join(workspaceRoot, '.github', `.${artifact.id}`);

    let downloadedCount = startCount;

    for (const filePath of artifact.supportingFiles) {
      try {
        downloadedCount++;
        progress.report({
          message: `Downloading ${downloadedCount}/${totalFiles}...`
        });

        // Resolve full URL for supporting file
        const fileUrl = `${catalogBaseUrl}/${filePath}`;

        // Download content
        const content = await this.http.fetchText(fileUrl, { auth });

        // Extract relative path from the supporting file path
        // e.g., "chatmodes/.../.ceo-advisor/scripts/analyzer.py" -> "scripts/analyzer.py"
        const relativePath = this.extractRelativePath(filePath, artifact.id);
        const targetPath = path.join(supportingDir, relativePath);

        // Ensure directory exists
        const dir = path.dirname(targetPath);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));

        // Write file
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(targetPath),
          Buffer.from(content, 'utf-8')
        );

        progress.report({
          increment: (1 / totalFiles) * 100
        });
      } catch (err) {
        // Log warning but continue with other files
        console.warn(`Failed to download supporting file ${filePath}:`, err);
        // Still update progress
        progress.report({
          increment: (1 / totalFiles) * 100
        });
      }
    }
  }

  private getCatalogBaseUrl(sourceUrl: string, artifactPath: string): string {
    // Remove the artifact path from the source URL to get base catalog URL
    // e.g., "https://gitlab.com/org/repo/-/raw/main/chatmodes/..." -> "https://gitlab.com/org/repo/-/raw/main"
    const pathIndex = sourceUrl.indexOf(artifactPath);
    if (pathIndex > 0) {
      return sourceUrl.substring(0, pathIndex).replace(/\/$/, '');
    }

    // Fallback: try to extract base URL
    const match = sourceUrl.match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+\/-\/raw\/[^/]+)/);
    if (match) {
      return match[1];
    }

    // GitHub fallback
    const ghMatch = sourceUrl.match(/^(https?:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+)/);
    if (ghMatch) {
      return ghMatch[1];
    }

    // Last resort: remove filename
    const lastSlash = sourceUrl.lastIndexOf('/');
    return sourceUrl.substring(0, lastSlash);
  }

  private extractRelativePath(fullPath: string, artifactId: string): string {
    // Extract the relative path after the artifact directory.
    // Supports both "<artifactId>/..." and ".<artifactId>/..." layouts.
    const parts = fullPath.split('/');
    const dotArtifactId = `.${artifactId}`;

    const dotIndex = parts.findIndex((part) => part === dotArtifactId);
    if (dotIndex >= 0 && dotIndex < parts.length - 1) {
      return parts.slice(dotIndex + 1).join('/');
    }

    const artifactIndex = parts.findIndex((part) => part === artifactId);
    if (artifactIndex >= 0 && artifactIndex < parts.length - 1) {
      return parts.slice(artifactIndex + 1).join('/');
    }

    const filename = parts[parts.length - 1];
    return filename || fullPath;
  }

  private getWorkspaceRootPath(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder open');
    }
    return workspaceFolder.uri.fsPath;
  }

  private async deleteDirectoryIfExists(targetPath: string): Promise<void> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
      await vscode.workspace.fs.delete(vscode.Uri.file(targetPath), { recursive: true });
    } catch {
      // Directory missing is fine
    }
  }

  private getInstallPath(artifact: ArtifactWithSource, installRoot: string): string {
    const workspaceRoot = this.getWorkspaceRootPath();
    const subdir = ARTIFACT_PATHS[artifact.type];
    const ext = ARTIFACT_EXTENSIONS[artifact.type];
    const filename = `${artifact.id}${ext}`;

    return path.join(workspaceRoot, installRoot, subdir, filename);
  }

  private async checkConflict(targetPath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
      return true;
    } catch {
      return false;
    }
  }

  private async promptConflictResolution(
    artifactName: string,
    targetPath: string
  ): Promise<ConflictResolution | null> {
    const action = await vscode.window.showWarningMessage(
      `"${path.basename(targetPath)}" already exists. What would you like to do?`,
      { modal: true },
      'Replace',
      'Keep Existing',
      'Rename'
    );

    if (!action) {
      return null;
    }

    if (action === 'Replace') {
      return { action: 'replace' };
    }

    if (action === 'Keep Existing') {
      return { action: 'keep' };
    }

    if (action === 'Rename') {
      const newName = await vscode.window.showInputBox({
        prompt: 'Enter new name (without extension)',
        value: path.basename(targetPath, path.extname(targetPath)) + '-2',
        validateInput: (value) => {
          if (!value || value.length === 0) {
            return 'Name cannot be empty';
          }
          if (!/^[a-z0-9-]+$/i.test(value)) {
            return 'Name can only contain letters, numbers, and hyphens';
          }
          return null;
        },
      });

      if (!newName) {
        return null;
      }

      return { action: 'rename', newName };
    }

    return null;
  }

  private async resolveDependencies(artifact: ArtifactWithSource): Promise<ArtifactWithSource[]> {
    if (!artifact.dependencies || artifact.dependencies.length === 0) {
      return [];
    }

    const deps: ArtifactWithSource[] = [];
    const visited = new Set<string>();

    const resolve = async (depId: string): Promise<void> => {
      if (visited.has(depId)) {
        return; // Avoid cycles
      }
      visited.add(depId);

      // Try to find dependency in same catalog first
      let dep = this.searchService.getArtifact(artifact.catalogId, depId);

      // If not found, search across all catalogs
      if (!dep) {
        const result = this.searchService.search({ query: depId, pageSize: 1 });
        dep = result.artifacts[0] || null;
      }

      if (!dep) {
        throw new Error(`Dependency not found: ${depId}`);
      }

      // Check if already installed
      const installed = this.getInstallation(dep.catalogId, dep.id);
      if (installed) {
        return; // Skip already installed
      }

      // Recursively resolve transitive dependencies
      if (dep.dependencies && dep.dependencies.length > 0) {
        for (const transitiveDep of dep.dependencies) {
          await resolve(transitiveDep);
        }
      }

      deps.push(dep);
    };

    for (const depId of artifact.dependencies) {
      await resolve(depId);
    }

    return deps;
  }
}

