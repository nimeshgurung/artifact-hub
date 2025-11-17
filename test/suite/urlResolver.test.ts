import * as assert from 'assert';
import { UrlResolver } from '../../src/services/UrlResolver';
import type { CatalogMetadata } from '../../src/models/types';

suite('UrlResolver Test Suite', () => {
  const resolver = new UrlResolver();

  test('should resolve GitLab URLs correctly', () => {
    const catalogMetadata: CatalogMetadata = {
      id: 'test',
      name: 'Test',
      description: 'Test catalog',
      author: { name: 'Test' },
      repository: {
        type: 'gitlab',
        url: 'https://gitlab.com/org/repo',
        branch: 'main',
      },
      license: 'MIT',
    };

    const artifact: any = {
      id: 'test-artifact',
      path: 'artifacts/test.md',
    };

    const url = resolver.resolveArtifactUrl(catalogMetadata, artifact);
    assert.strictEqual(
      url,
      'https://gitlab.com/org/repo/-/raw/main/artifacts/test.md'
    );
  });

  test('should resolve GitHub URLs correctly', () => {
    const catalogMetadata: CatalogMetadata = {
      id: 'test',
      name: 'Test',
      description: 'Test catalog',
      author: { name: 'Test' },
      repository: {
        type: 'github',
        url: 'https://github.com/org/repo',
        branch: 'main',
      },
      license: 'MIT',
    };

    const artifact: any = {
      id: 'test-artifact',
      path: 'artifacts/test.md',
    };

    const url = resolver.resolveArtifactUrl(catalogMetadata, artifact);
    assert.strictEqual(
      url,
      'https://raw.githubusercontent.com/org/repo/main/artifacts/test.md'
    );
  });

  test('should use default branch when not specified', () => {
    const catalogMetadata: CatalogMetadata = {
      id: 'test',
      name: 'Test',
      description: 'Test catalog',
      author: { name: 'Test' },
      repository: {
        type: 'github',
        url: 'https://github.com/org/repo',
      },
      license: 'MIT',
    };

    const artifact: any = {
      id: 'test-artifact',
      path: 'artifacts/test.md',
    };

    const url = resolver.resolveArtifactUrl(catalogMetadata, artifact);
    assert.ok(url.includes('/main/'));
  });

  test('should detect catalog URL type', () => {
    assert.strictEqual(
      resolver.getCatalogUrlType('https://gitlab.com/org/repo'),
      'gitlab'
    );
    assert.strictEqual(
      resolver.getCatalogUrlType('https://github.com/org/repo'),
      'github'
    );
    assert.strictEqual(
      resolver.getCatalogUrlType('https://example.com/catalog.json'),
      'generic'
    );
  });

  test('should handle bare domain URLs correctly', () => {
    const catalogMetadata: CatalogMetadata = {
      id: 'test',
      name: 'Test',
      description: 'Test catalog',
      author: { name: 'Test' },
      repository: {
        type: 'generic',
        url: 'https://chatmode-53b054.gitlab.io',
      },
      license: 'MIT',
    };

    const artifact: any = {
      id: 'test-artifact',
      path: 'chatmodes/generated/test.md',
    };

    const url = resolver.resolveArtifactUrl(catalogMetadata, artifact);
    assert.strictEqual(
      url,
      'https://chatmode-53b054.gitlab.io/chatmodes/generated/test.md'
    );
  });

  test('should handle various TLDs without treating them as file extensions', () => {
    const testCases = [
      {
        domain: 'https://artifacts.company.com',
        expected: 'https://artifacts.company.com/catalog/artifact.md'
      },
      {
        domain: 'https://pages.dev',
        expected: 'https://pages.dev/catalog/artifact.md'
      },
      {
        domain: 'https://my-project.vercel.app',
        expected: 'https://my-project.vercel.app/catalog/artifact.md'
      },
      {
        domain: 'https://artifacts.netlify.app',
        expected: 'https://artifacts.netlify.app/catalog/artifact.md'
      },
      {
        domain: 'https://my-site.github.io',
        expected: 'https://my-site.github.io/catalog/artifact.md'
      },
      {
        domain: 'https://example.co.uk',
        expected: 'https://example.co.uk/catalog/artifact.md'
      },
      {
        domain: 'https://artifacts.internal',
        expected: 'https://artifacts.internal/catalog/artifact.md'
      },
      {
        domain: 'https://devcloud.ubs.net',
        expected: 'https://devcloud.ubs.net/catalog/artifact.md'
      }
    ];

    testCases.forEach(({ domain, expected }) => {
      const catalogMetadata: CatalogMetadata = {
        id: 'test',
        name: 'Test',
        description: 'Test catalog',
        author: { name: 'Test' },
        repository: {
          type: 'generic',
          url: domain,
        },
        license: 'MIT',
      };

      const artifact: any = {
        id: 'test-artifact',
        path: 'catalog/artifact.md',
      };

      const url = resolver.resolveArtifactUrl(catalogMetadata, artifact);
      assert.strictEqual(url, expected, `Failed for domain: ${domain}`);
    });
  });

  test('should strip filename when URL contains path with file extension', () => {
    const catalogMetadata: CatalogMetadata = {
      id: 'test',
      name: 'Test',
      description: 'Test catalog',
      author: { name: 'Test' },
      repository: {
        type: 'generic',
        url: 'https://example.com/catalogs/copilot-catalog.json',
      },
      license: 'MIT',
    };

    const artifact: any = {
      id: 'test-artifact',
      path: 'artifacts/test.md',
    };

    const url = resolver.resolveArtifactUrl(catalogMetadata, artifact);
    assert.strictEqual(
      url,
      'https://example.com/catalogs/artifacts/test.md'
    );
  });

  test('should handle URLs with paths but no file extension', () => {
    const catalogMetadata: CatalogMetadata = {
      id: 'test',
      name: 'Test',
      description: 'Test catalog',
      author: { name: 'Test' },
      repository: {
        type: 'generic',
        url: 'https://example.com/api/artifacts',
      },
      license: 'MIT',
    };

    const artifact: any = {
      id: 'test-artifact',
      path: 'chatmodes/test.md',
    };

    const url = resolver.resolveArtifactUrl(catalogMetadata, artifact);
    assert.strictEqual(
      url,
      'https://example.com/api/artifacts/chatmodes/test.md'
    );
  });

  test('should handle URLs with trailing slashes', () => {
    const catalogMetadata: CatalogMetadata = {
      id: 'test',
      name: 'Test',
      description: 'Test catalog',
      author: { name: 'Test' },
      repository: {
        type: 'generic',
        url: 'https://example.com/artifacts/',
      },
      license: 'MIT',
    };

    const artifact: any = {
      id: 'test-artifact',
      path: 'chatmodes/test.md',
    };

    const url = resolver.resolveArtifactUrl(catalogMetadata, artifact);
    assert.strictEqual(
      url,
      'https://example.com/artifacts/chatmodes/test.md'
    );
  });
});

