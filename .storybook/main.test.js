/**
 * @file Tests for the shared Storybook main config.
 */

import { execFileSync } from 'node:child_process';

describe('Storybook main config', () => {
  it('appends project preview head overrides from installed package consumers', () => {
    const script = `
      const { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      const { pathToFileURL } = await import('node:url');

      const repoRoot = process.cwd();
      const projectRoot = mkdtempSync(path.join(tmpdir(), 'emulsify-storybook-'));
      const packageRoot = path.join(
        projectRoot,
        'node_modules/@emulsify/core',
      );
      mkdirSync(path.dirname(packageRoot), { recursive: true });
      symlinkSync(repoRoot, packageRoot, 'dir');
      mkdirSync(
        path.join(projectRoot, 'config/emulsify-core/storybook'),
        { recursive: true },
      );
      writeFileSync(
        path.join(
          projectRoot,
          'config/emulsify-core/storybook/preview-head.html',
        ),
        '<meta name="preview-override" content="yes">',
      );
      process.chdir(projectRoot);

      const { default: config } = await import(
        pathToFileURL(path.join(packageRoot, '.storybook/main.js')).href
      );

      console.log(JSON.stringify({
        head: config.previewHead('<meta name="existing-preview">'),
      }));
    `;
    const output = execFileSync(process.execPath, [
      '--preserve-symlinks',
      '--input-type=module',
      '--eval',
      script,
    ]);
    const { head } = JSON.parse(output.toString());

    expect(head).toContain('<meta name="existing-preview">');
    expect(head).toContain('<meta name="preview-override" content="yes">');
  });

  it('appends project manager head overrides from installed package consumers', () => {
    const script = `
      const { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      const { pathToFileURL } = await import('node:url');

      const repoRoot = process.cwd();
      const projectRoot = mkdtempSync(path.join(tmpdir(), 'emulsify-storybook-'));
      const packageRoot = path.join(
        projectRoot,
        'node_modules/@emulsify/core',
      );
      mkdirSync(path.dirname(packageRoot), { recursive: true });
      symlinkSync(repoRoot, packageRoot, 'dir');
      mkdirSync(
        path.join(projectRoot, 'config/emulsify-core/storybook'),
        { recursive: true },
      );
      writeFileSync(
        path.join(
          projectRoot,
          'config/emulsify-core/storybook/manager-head.html',
        ),
        '<meta name="manager-override" content="yes">',
      );
      process.chdir(projectRoot);

      const { default: config } = await import(
        pathToFileURL(path.join(packageRoot, '.storybook/main.js')).href
      );

      console.log(JSON.stringify({
        head: config.managerHead('<meta name="existing-manager">'),
      }));
    `;
    const output = execFileSync(process.execPath, [
      '--preserve-symlinks',
      '--input-type=module',
      '--eval',
      script,
    ]);
    const { head } = JSON.parse(output.toString());

    expect(head).toContain('<meta name="existing-manager">');
    expect(head).toContain('<meta name="manager-override" content="yes">');
  });

  it('ignores missing project head override files from installed package consumers', () => {
    const script = `
      const { mkdirSync, mkdtempSync, symlinkSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      const { pathToFileURL } = await import('node:url');

      const repoRoot = process.cwd();
      const projectRoot = mkdtempSync(path.join(tmpdir(), 'emulsify-storybook-'));
      const packageRoot = path.join(
        projectRoot,
        'node_modules/@emulsify/core',
      );
      mkdirSync(path.dirname(packageRoot), { recursive: true });
      symlinkSync(repoRoot, packageRoot, 'dir');
      process.chdir(projectRoot);

      const { default: config } = await import(
        pathToFileURL(path.join(packageRoot, '.storybook/main.js')).href
      );

      console.log(JSON.stringify({
        previewHead: config.previewHead('<meta name="existing-preview">'),
        managerHead: config.managerHead('<meta name="existing-manager">'),
      }));
    `;
    const output = execFileSync(process.execPath, [
      '--preserve-symlinks',
      '--input-type=module',
      '--eval',
      script,
    ]);
    const { previewHead, managerHead } = JSON.parse(output.toString());

    expect(previewHead).toContain('<meta name="existing-preview">');
    expect(previewHead).not.toContain('preview-override');
    expect(managerHead).toContain('<meta name="existing-manager">');
    expect(managerHead).not.toContain('manager-override');
  });

  it('serves project root assets at the /assets URL prefix', () => {
    const script = `
      const path = await import('node:path');
      const { default: config } = await import('./.storybook/main.js');
      console.log(JSON.stringify({
        staticDirs: config.staticDirs,
        expectedFrom: path.resolve(process.cwd(), 'assets'),
      }));
    `;
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      script,
    ]);
    const { staticDirs, expectedFrom } = JSON.parse(output.toString());

    expect(staticDirs).toContainEqual({
      from: expectedFrom,
      to: '/assets',
    });
  });

  it('serves configured asset roots at the /assets URL prefix', () => {
    const script = `
      const { mkdirSync, mkdtempSync, writeFileSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      const { pathToFileURL } = await import('node:url');

      const repoRoot = process.cwd();
      const projectRoot = mkdtempSync(path.join(tmpdir(), 'emulsify-storybook-'));
      mkdirSync(path.join(projectRoot, 'custom-assets'), { recursive: true });
      mkdirSync(path.join(projectRoot, 'src/assets'), { recursive: true });
      writeFileSync(
        path.join(projectRoot, 'project.emulsify.json'),
        JSON.stringify({
          project: {
            platform: 'none',
          },
          projectStructure: {
            assetRoots: ['custom-assets'],
          },
        }),
      );
      process.chdir(projectRoot);

      const { default: config } = await import(
        pathToFileURL(path.join(repoRoot, '.storybook/main.js')).href
      );

      console.log(JSON.stringify({
        staticDirs: config.staticDirs,
        projectRoot: process.cwd(),
      }));
    `;
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      script,
    ]);
    const { staticDirs, projectRoot } = JSON.parse(output.toString());

    expect(staticDirs).toEqual([
      {
        from: `${projectRoot}/custom-assets`,
        to: '/assets',
      },
      {
        from: `${projectRoot}/src/assets`,
        to: '/assets',
      },
    ]);
  });

  it('serves compiled dist assets without mounting all dist files at the output root', () => {
    const script = `
      const { mkdirSync, mkdtempSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      const { pathToFileURL } = await import('node:url');

      const repoRoot = process.cwd();
      const projectRoot = mkdtempSync(path.join(tmpdir(), 'emulsify-storybook-'));
      mkdirSync(path.join(projectRoot, 'assets'), { recursive: true });
      mkdirSync(path.join(projectRoot, 'dist/assets'), { recursive: true });
      mkdirSync(path.join(projectRoot, 'dist/storybook'), { recursive: true });
      process.chdir(projectRoot);

      const { default: config } = await import(
        pathToFileURL(path.join(repoRoot, '.storybook/main.js')).href
      );

      console.log(JSON.stringify({
        staticDirs: config.staticDirs,
        projectRoot: process.cwd(),
      }));
    `;
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      script,
    ]);
    const { staticDirs, projectRoot } = JSON.parse(output.toString());

    expect(staticDirs).toEqual([
      {
        from: `${projectRoot}/assets`,
        to: '/assets',
      },
      {
        from: `${projectRoot}/dist/assets`,
        to: '/assets',
      },
      {
        from: `${projectRoot}/dist`,
        to: '/dist',
      },
    ]);
  });

  it('keeps Storybook preview build assets separate from static /assets', async () => {
    const script = `
      const { default: config } = await import('./.storybook/main.js');
      const finalConfig = await config.viteFinal({
        mode: 'production',
        build: {
          outDir: '.out',
          assetsDir: 'assets',
          emptyOutDir: false,
        },
        server: {
          fs: {
            allow: [],
          },
        },
        optimizeDeps: {},
      });
      console.log(JSON.stringify(finalConfig.build));
    `;
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      script,
    ]);
    const build = JSON.parse(output.toString());

    expect(build.outDir).toBe('.out');
    expect(build.assetsDir).toBe('storybook-assets');
    expect(build.emptyOutDir).toBe(false);
  });

  it('loads compiled dist CSS as stylesheet links instead of module imports', async () => {
    const script = `
      const { mkdirSync, mkdtempSync, writeFileSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      const { pathToFileURL } = await import('node:url');

      const repoRoot = process.cwd();
      const projectRoot = mkdtempSync(path.join(tmpdir(), 'emulsify-storybook-'));
      mkdirSync(path.join(projectRoot, 'dist/components/card'), { recursive: true });
      mkdirSync(path.join(projectRoot, 'dist/global'), { recursive: true });
      writeFileSync(path.join(projectRoot, 'dist/components/card/card.css'), '.card {}');
      writeFileSync(path.join(projectRoot, 'dist/global/foundation.css'), '.foundation {}');
      process.chdir(projectRoot);

      const { default: config } = await import(
        pathToFileURL(path.join(repoRoot, '.storybook/main.js')).href
      );
      const finalConfig = await config.viteFinal({
        mode: 'development',
        server: {
          fs: {
            allow: [],
          },
        },
        optimizeDeps: {},
      });
      const plugin = finalConfig.plugins.find(
        (item) => item && item.name === 'emulsify-storybook-css-links',
      );

      console.log(JSON.stringify({
        dist: plugin.load(
          plugin.resolveId('virtual:emulsify-storybook-css/dist'),
        ),
        sharedDist: plugin.load(
          plugin.resolveId('virtual:emulsify-storybook-css/shared-dist'),
        ),
      }));
    `;
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      script,
    ]);
    const modules = JSON.parse(output.toString());

    expect(modules.dist).toContain('"dist/components/card/card.css"');
    expect(modules.dist).toContain('"dist/global/foundation.css"');
    expect(modules.dist).toMatch(/document\.createElement\('link'\)/);
    expect(modules.dist).not.toContain('import.meta.glob');
    expect(modules.sharedDist).not.toContain('dist/components/card/card.css');
    expect(modules.sharedDist).toContain('"dist/global/foundation.css"');
  });

  it('serves generated dist assets that appear after Storybook config loads', async () => {
    const script = `
      const { mkdirSync, mkdtempSync, writeFileSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      const { pathToFileURL } = await import('node:url');

      const repoRoot = process.cwd();
      const projectRoot = mkdtempSync(path.join(tmpdir(), 'emulsify-storybook-'));
      process.chdir(projectRoot);

      const { default: config } = await import(
        pathToFileURL(path.join(repoRoot, '.storybook/main.js')).href
      );
      const finalConfig = await config.viteFinal({
        mode: 'development',
        server: {
          fs: {
            allow: [],
          },
        },
        optimizeDeps: {},
      });
      const plugin = finalConfig.plugins.find(
        (item) => item && item.name === 'emulsify-storybook-css-links',
      );
      let middleware;
      plugin.configureServer({
        middlewares: {
          use(fn) {
            middleware = fn;
          },
        },
        watcher: {
          add() {},
          on() {},
        },
        moduleGraph: {
          getModuleById() {},
          invalidateModule() {},
        },
        ws: {
          send() {},
        },
      });

      mkdirSync(path.join(projectRoot, 'dist/assets'), { recursive: true });
      writeFileSync(path.join(projectRoot, 'dist/assets/icons.svg'), '<svg></svg>');

      let nextCalled = false;
      const response = {
        headers: {},
        statusCode: 0,
        setHeader(name, value) {
          this.headers[name] = value;
        },
        end(value = '') {
          this.body = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
        },
      };
      middleware(
        { method: 'GET', url: '/assets/icons.svg' },
        response,
        () => {
          nextCalled = true;
        },
      );

      console.log(JSON.stringify({
        body: response.body,
        contentType: response.headers['Content-Type'],
        nextCalled,
        staticDirs: config.staticDirs,
      }));
    `;
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      script,
    ]);
    const result = JSON.parse(output.toString());

    expect(result.staticDirs).toEqual([]);
    expect(result.nextCalled).toBe(false);
    expect(result.contentType).toBe('image/svg+xml; charset=utf-8');
    expect(result.body).toBe('<svg></svg>');
  });

  it('dedupes React runtime modules in the final Vite config', async () => {
    const script = `
      const { default: config } = await import('./.storybook/main.js');
      const finalConfig = await config.viteFinal({
        mode: 'development',
        resolve: {
          dedupe: ['example', 'react'],
        },
        optimizeDeps: {
          include: ['example-dep', 'react'],
        },
        server: {
          fs: {
            allow: [],
          },
        },
      });
      console.log(JSON.stringify({
        dedupe: finalConfig.resolve.dedupe,
        include: finalConfig.optimizeDeps.include,
        exclude: finalConfig.optimizeDeps.exclude,
        esbuildPluginNames: finalConfig.optimizeDeps.esbuildOptions.plugins.map(
          (plugin) => plugin.name,
        ),
      }));
    `;
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      script,
    ]);
    const finalConfig = JSON.parse(output.toString());

    expect(finalConfig.dedupe).toEqual([
      'example',
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ]);
    expect(finalConfig.include).toEqual([
      'example-dep',
      'react',
      'twig',
      '@emulsify/core/extensions/twig',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ]);
    expect(finalConfig.exclude).toEqual([
      'virtual:emulsify-twig-globs',
      'virtual:emulsify-twig-asset-sources',
      'virtual:emulsify-twig-extension-installers',
      'virtual:emulsify-storybook-css/dist',
      'virtual:emulsify-storybook-css/shared-dist',
      '@emulsify/core/storybook/twig/source-function',
      '@emulsify/core/storybook/twig/source',
      '@emulsify/core/storybook/twig/resolver',
    ]);
    expect(finalConfig.esbuildPluginNames).toContain(
      'emulsify-twig-virtual-modules',
    );
  });
});
