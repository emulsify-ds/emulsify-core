/**
 * @file Exercise Twig HMR through the installed Vite server's watcher handlers.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

it('refreshes Twig references on Vite create, update, and delete events in each environment', () => {
  const viteUrl = pathToFileURL(
    join(process.cwd(), 'node_modules/vite/dist/node/index.js'),
  ).href;
  const pluginUrl = pathToFileURL(
    join(process.cwd(), 'config/vite/plugins/twig/twig-module.js'),
  ).href;
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { tmpdir } from 'node:os';
    import { dirname, join } from 'node:path';
    import { createServer } from ${JSON.stringify(viteUrl)};
    import { emulsifyTwigModulePlugin } from ${JSON.stringify(pluginUrl)};

    const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'emulsify-twig-hmr-')));
    const externalRoot = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'emulsify-twig-shared-')));
    const componentRoot = join(root, 'src/components');
    const parent = join(componentRoot, 'card/card.twig');
    const original = join(componentRoot, 'beta/text/heading/heading.twig');
    const preferred = join(componentRoot, 'alpha/text/heading/heading.twig');
    fs.mkdirSync(dirname(parent), { recursive: true });
    fs.writeFileSync(parent, '{% include "theme:heading" %}');
    const plugin = emulsifyTwigModulePlugin({
      root: join(root, 'src'),
      projectDir: root,
      namespaces: { components: componentRoot, shared: externalRoot },
    });
    const calls = [];
    const hookName = plugin.hotUpdate ? 'hotUpdate' : 'handleHotUpdate';
    const originalHook = plugin[hookName];
    plugin[hookName] = function (context) {
      calls.push(hookName + ':' + this.environment?.name + ':' + context.type);
      return originalHook.call(this, context);
    };
    let completeEvent;
    const observed = [];
    const server = await createServer({
      root,
      configFile: false,
      envFile: false,
      publicDir: false,
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [plugin, {
        name: 'observe-twig-hot-update',
        hotUpdate(context) {
          observed.push([this.environment.name, context.modules]);
        },
      }],
      server: {
        middlewareMode: true,
        watch: null,
        ws: false,
        hotUpdateEnvironments: async () => completeEvent(),
      },
    });
    try {
      await server.environments.client.pluginContainer.buildStart({});
      const environments = Object.values(server.environments);
      const parents = await Promise.all(environments.map(environment =>
        environment.moduleGraph.ensureEntryFromUrl('/src/components/card/card.twig'),
      ));
      const compile = () => plugin.transform.call({ addWatchFile() {} }, '', parent);
      const dependencyId = file => 'virtual:emulsify-twig-dep:' + encodeURIComponent(file);
      const initial = await compile();
      assert.ok(!initial.code.includes('from "virtual:emulsify-twig-dep:'));

      const dispatch = async (event, file, expectedFile) => {
        calls.length = 0;
        observed.length = 0;
        for (const module of parents) module.transformResult = { code: 'cached' };
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Vite HMR timed out')), 5000);
          completeEvent = () => { clearTimeout(timeout); resolve(); };
          // The real Vite handlers translate add/unlink/change into typed HMR
          // events; no hot-update hook is called directly by this test.
          server.watcher.emit(event, file);
        });
        const updated = await compile();
        assert.ok(!updated.code.includes('An error occurred whilst compiling'), updated.code);
        if (expectedFile) {
          assert.ok(updated.code.includes(dependencyId(expectedFile)),
            event + ' must resolve to ' + expectedFile);
        } else {
          assert.ok(!updated.code.includes('from "virtual:emulsify-twig-dep:'),
            'deleted reference must not retain a dependency');
        }
        const type = { add: 'create', change: 'update', unlink: 'delete' }[event];
        assert.deepEqual(calls, environments.map(environment =>
          'hotUpdate:' + environment.name + ':' + type,
        ));
        for (const [index, environment] of environments.entries()) {
          assert.equal(parents[index].transformResult, null,
            environment.name + ' must invalidate its own importer');
          const modules = observed.find(([name]) => name === environment.name)[1];
          assert.ok(modules.includes(parents[index]));
          assert.ok(modules.every(module => module.environment === environment.name));
        }
      };

      fs.mkdirSync(dirname(original), { recursive: true });
      fs.writeFileSync(original, '<h2>Original</h2>');
      await dispatch('add', original, original);
      fs.writeFileSync(original, '<h2>Updated</h2>');
      await dispatch('change', original, original);
      const dependency = await plugin.load.call(
        { addWatchFile() {} }, plugin.resolveId(dependencyId(original)),
      );
      assert.ok(dependency.includes('Updated'));
      fs.mkdirSync(dirname(preferred), { recursive: true });
      fs.writeFileSync(preferred, '<h2>Preferred</h2>');
      await dispatch('add', preferred, preferred);
      fs.rmSync(dirname(preferred), { recursive: true });
      await dispatch('unlink', preferred, original);
      fs.rmSync(dirname(original), { recursive: true });
      await dispatch('unlink', original, null);

      const external = join(externalRoot, 'heading.twig');
      fs.writeFileSync(external, '<h2>Shared outside project</h2>');
      fs.writeFileSync(parent, '{% include "@shared/heading.twig" %}');
      await dispatch('change', parent, external);
      fs.unlinkSync(external);
      await dispatch('unlink', external, null);
      fs.writeFileSync(external, '<h2>Recreated outside project</h2>');
      await dispatch('add', external, external);
    } finally {
      await server.close();
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(externalRoot, { recursive: true, force: true });
    }
  `;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    { encoding: 'utf8', timeout: 25_000 },
  );

  if (result.status !== 0) {
    throw new Error(
      [result.stdout, result.stderr, result.error].filter(Boolean).join('\n'),
    );
  }
}, 30_000);
