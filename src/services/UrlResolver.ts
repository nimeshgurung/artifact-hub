import type { Artifact, CatalogMetadata } from '../models/types';

export class UrlResolver {
  resolveArtifactUrl(catalogMetadata: CatalogMetadata, artifact: Artifact): string {
    const repo = catalogMetadata.repository;

    switch (repo.type.toLowerCase()) {
      case 'gitlab':
        return this.resolveGitLabUrl(repo.url, repo.branch, artifact.path);
      case 'github':
        return this.resolveGitHubUrl(repo.url, repo.branch, artifact.path);
      default:
        return this.resolveGenericUrl(repo.url, artifact.path);
    }
  }

  private resolveGitLabUrl(repoUrl: string, branch: string | undefined, artifactPath: string): string {
    // Input: https://gitlab.com/org/repo or https://gitlab.com/org/repo/-/raw/main/...
    // Output: https://gitlab.com/org/repo/-/raw/{branch}/{path}

    const cleanUrl = repoUrl.replace(/\/-\/raw\/.*$/, '').replace(/\/$/, '');
    const branchName = branch || 'main';
    return `${cleanUrl}/-/raw/${branchName}/${artifactPath}`;
  }

  private resolveGitHubUrl(repoUrl: string, branch: string | undefined, artifactPath: string): string {
    // Input: https://github.com/org/repo or https://raw.githubusercontent.com/org/repo/...
    // Output: https://raw.githubusercontent.com/org/repo/{branch}/{path}

    let cleanUrl = repoUrl;

    // Convert github.com to raw.githubusercontent.com
    if (cleanUrl.includes('github.com') && !cleanUrl.includes('raw.githubusercontent.com')) {
      cleanUrl = cleanUrl.replace('github.com', 'raw.githubusercontent.com');
    }

    // Remove any existing path after repo name
    cleanUrl = cleanUrl.replace(/\/(raw|blob)\/.*$/, '').replace(/\/$/, '');

    const branchName = branch || 'main';
    return `${cleanUrl}/${branchName}/${artifactPath}`;
  }

  private resolveGenericUrl(baseUrl: string, artifactPath: string): string {
    // For generic URLs, assume the baseUrl is a directory
    // and just append the artifact path
    const cleanUrl = baseUrl.replace(/\/$/, '');

    // If baseUrl already ends with a filename (has extension), get directory
    // But don't treat domain TLDs as file extensions
    try {
      const urlObj = new URL(cleanUrl);
      const pathname = urlObj.pathname;

      // If there's a pathname with a file extension (e.g., /path/catalog.json)
      if (pathname && pathname !== '/' && /\.[a-z0-9]+$/i.test(pathname)) {
        const lastSlash = cleanUrl.lastIndexOf('/');
        const directory = cleanUrl.substring(0, lastSlash);
        return `${directory}/${artifactPath}`;
      }
    } catch {
      // Invalid URL, fall through to simple concatenation
    }

    return `${cleanUrl}/${artifactPath}`;
  }

  getCatalogUrlType(url: string): 'gitlab' | 'github' | 'generic' {
    if (url.includes('gitlab')) {
      return 'gitlab';
    }
    if (url.includes('github')) {
      return 'github';
    }
    return 'generic';
  }
}

