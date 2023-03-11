import type { Site } from "lume/core.ts";
import { join } from "std/path/mod.ts";
import { emptyDir } from "std/fs/mod.ts";
import type { Package } from "./local-package.ts";

import { type Options as BuildOptions } from "lume/plugins/esbuild.ts";
// TODO: try https://github.com/sanyuan0704/vite-plugin-chunk-split
/* TODO: create rollup-plugin-swc-wasm based on:
https://github.com/egoist/unplugin-swc
  or
https://github.com/SukkaW/rollup-plugin-swc
  or
make PR to rollup-plugin-swc3 to support wasm
*/
import { type OutputOptions, rollup, type RollupOptions } from "rollup"; // BUG(bundle): try Parcel! Rollup heuristics doesn't look great. It doesn't inline all `const` in constant/colon.ts
import sucrase from "rollup/plugin-sucrase";
import esbuild from "rollup/plugin-esbuild";
// import { swc } from "rollup/plugin-swc";
// import terser from "rollup/plugin-terser";

// TODO: create universal abstraction to integrate lume/plugins/esbuild

type BuildConfig = BuildOptions["options"];
export interface Options extends BuildConfig {
  excludes?: string[];
}

export default (conf: Options, pkgPath: string) => (site: Site) => {
  const config: BuildConfig = {
    outdir: join(site.options.dest, pkgPath),
    format: "esm",
    target: "esnext",
    platform: "browser",
  };
  config.bundle = config.minify = true;
  Object.assign(config, conf);

  let cache: RollupOptions["cache"] | undefined = false;
  site
    // .copy("package.json", join(pkgPath, "package.json"))
    .addEventListener("afterStartServer", () => {
      cache = undefined; // enable cache
      config.watch = config.incremental = true;
    });

  // TODO
  /** Map { <script>.href => <script>.type === module } */
  // const manifestExts = [".json"];
  const scriptExts = [".js", ".jsx", ".mjs", ".ts", ".tsx", ".mts"];

  // site.process(manifestExts, (page) => {
  //   if (page.src.slug === "package") {
  //     const pkg: PackageJson = JSON.parse(page.content as string);
  //   }
  // }).loadAssets(manifestExts);

  site.processAll(scriptExts, (pages) => {
    const scripts = new Map<string, string | RegExp>(),
      modules = new Map<string, string | RegExp>(),
      unknowns = new Map<string, string | RegExp>();

    site.hooks.forEachPackage((pkg: Package, path: string) => {
      for (const [dest, exports] of pkg.exports) {
        if (Object.hasOwn(exports, "script")) {
          scripts.set(join(path, exports.script), dest);
        } else if (Object.hasOwn(exports, "import")) {
          modules.set(join(path, exports.import), dest);
        } else if (Object.hasOwn(exports, "default")) {
          unknowns.set(join(path, exports.default), dest);
        }
      }
    });

    const input: string[] = [], nonModules = new Set<string>();

    for (const page of pages) {
      if (scripts.has(page.src.path)) nonModules.add(page.src.path);
      else input.push(page.src.path);
      // TODO: patch if exports <has> { script }
      // TODO: groupBy package.json
    }
  }).loadAssets(scriptExts);

  const bundle = async (input: string[], nonModules: Set<string>) => {
    await emptyDir(config.outdir!);

    const whitespace = config.minify || config.minifyWhitespace ? "" : "\n";
    const cfg = {
      input: {
        treeshake: {
          moduleSideEffects: false,
          unknownGlobalSideEffects: false,
          tryCatchDeoptimization: false,
          propertyReadSideEffects: false,
        },
        plugins: [
          /* WARNING: enable sucrase only when there is *.mts since rollup-plugin-esbuild not process them (most likely a bug cuz in the past typescript doesn't acknowledge .mts)
          sucrase({ // TODO: try SWC 🤔
            transforms: ["typescript"],
            disableESTransforms: true,
          }),
          */
          /* BUG(deno): something wrong when using node:worker_threads
                  error: Uncaught (in worker "$DENO_STD_NODE_WORKER_THREAD") Top-level await promise never resolved
                    [{ threadId, workerData, environmentData }] = await once(
                                                                  ^
                      at <anonymous> (https://deno.land/std@0.168.0/node/worker_threads.ts:178:49)
                  error: Uncaught Error: Unhandled error in child worker.
                      at Worker.#pollControl (deno:runtime/js/11_workers.js:155:21)
              */
          // config.minify ? terser(),
          // TODO: emit *.d.ts based on package.json#exports.*.types using https://github.com/Swatinem/rollup-plugin-dts
          // @ts-ignore: npm:rollup-plugin-esbuild doesn't provide type declaration
          esbuild({
            ...conf,
            target: "esnext",
            // BUG(rollup-plugin-esbuild): can't handle import from *.mts
            // include: /\.[mc]?[jt]sx?$/,
            // loader: { ".mts": "ts", ".ts": "ts" },
            // resolveExtensions: [".ts", ".mts"],
          }),
        ],
      } satisfies RollupOptions,

      output: {
        dir: config.outdir,
        sourcemap: !!config.sourcemap,
        freeze: false,
        generatedCode: {
          constBindings: true,
          objectShorthand: true,
        },
        compact: config.minify,
        format: "es",
        externalLiveBindings: false,
        hoistTransitiveImports: false,
      } satisfies OutputOptions,
    };

    const build = await rollup({
      ...cfg.input,
      cache,
      input,
      preserveEntrySignatures: "allow-extension",
    });
    if (cache !== false) cache = build.cache;

    const gen = await build.generate(cfg.output);
    for (const output of gen.output) {
      const outputPath = join(config.outdir!, output.fileName);
      const bugs = ["current.js"] as const;
      switch (output.type) {
        case "chunk": {
          let code = output.code;
          if (nonModules.has(output.name)) {
            code = '"use strict";' + "(function(){" + whitespace + code;
            if (config.sourcemap) {
              code = code.replace(
                "\n//# sourceMappingURL",
                whitespace + "})()" + "\n//# sourceMappingURL",
              );
            } else {
              code = code.slice(0, code.at(-2) === ";" ? -2 : -1);
              code += whitespace + "})()" + "\n";
            }
          }
          if (output.fileName === bugs[0]) {
            const hash = code.match(/import.*from".\/registry-(.*).js/)![1];
            code = `export{event,value}from"./registry-${hash}.js";\n` +
              (config.sourcemap
                ? `//# sourceMappingURL=registry-${hash}.js.map\n`
                : "");
          }
          Deno.writeTextFile(outputPath, code); // TODO: remove this and use site.processAll()
          break;
        }
        case "asset": {
          const asset = output.source;
          // TODO: remove this and use site.processAll()
          if (typeof asset === "string") Deno.writeTextFile(outputPath, asset);
          else Deno.writeFile(outputPath, asset);
          break;
        }
      }
    }
  };
};
