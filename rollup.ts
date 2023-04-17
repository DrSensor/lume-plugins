// deno-lint-ignore-file no-cond-assign
import type { Site } from "lume/core.ts";
import { Page } from "lume/core/filesystem.ts";
import { prepareAsset, saveAsset } from "lume/plugins/source_maps.ts";
import { globToRegExp, join, parse } from "std/path/mod.ts";
import type { Exports, PackageExports } from "./local-package.ts";

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

type BuildConfig = BuildOptions["options"] & RollupOptions;
export interface Options extends BuildConfig {
  excludes?: string[];
  shimPrivateExports?: content | Record<glob | condition, content>;
  shimPrivatePackage?: content | path | Record<glob, content | path>;
  exportsDefault?: "import" | "script";
}
type content = string;
type path = `./${string}`;
type glob = `./${string}`;
type condition = "import" | "script" | "types" | "asset" | "style" | "sass";

export default (opts: Options = {}) => (site: Site) => {
  const config: BuildConfig = {
    outdir: site.options.dest,
    format: "esm",
    target: "esnext",
    platform: "browser",
  };
  config.bundle = config.minify = true;
  Object.assign(config, opts);

  let cache: RollupOptions["cache"];
  const cachePkg = {} as Record<string, typeof cache>;

  const scriptExts = [".ts", ".tsx", ".mts"];
  site.processAll(scriptExts, (pages, all) => {
    const pkgs: Record<string, {
      private: boolean;
      exports: Exports;
      patterns: Exports;
      pages: Record<string, Page>;
      input: Set<string>;
      nomodule: Set<string>;
    }> = {};

    site.hooks.forEachPackage((
      name: string,
      { exacts, patterns }: PackageExports,
      isPrivate: boolean,
    ) => {
      const input = new Set<string>(), nomodule = new Set<string>();
      const exports: Exports = {};
      for (const [dest, entry] of Object.entries(exacts)) {
        if (entry) {
          for (const [condition, src] of Object.entries(entry)) {
            if (
              condition === "script" ||
              (condition === "default" && opts.exportsDefault === "script")
            ) nomodule.add(src);
            if (
              condition === "import" || condition === "script" ||
              (condition === "default" && opts.exportsDefault != null)
            ) {
              input.add("." + src);
              (exports[dest] ??= {})[condition] = parse(src).name + ".js";
            }
          }
        }
      }
      pkgs[name] = {
        private: isPrivate,
        pages: {},
        exports,
        patterns,
        input,
        nomodule,
      };
    });

    const nonPkg = { input: [] as string[], nomodule: new Set<string>() };
    let enableAllSourceMaps; // TODO: per local-package

    for (const page of pages) {
      const asset = prepareAsset(site, page);
      if (asset.enableSourceMap) enableAllSourceMaps = true;

      const src = page.src.path + page.src.ext;
      let isPkg;
      for (const pkg of Object.values(pkgs)) {
        if (pkg.input.has(src)) { // check if page.src is in exact exports.*:path
          pkg.pages[parse(src).name + ".js"] = page; // remember that rollup doesn't preserve path
          isPkg = true;
          continue; // say no more! prepare page.src to be bundled
        }

        for (const [dest, entry] of Object.entries(pkg.patterns)) {
          if (!entry) continue; // most likely exact exports.*:path 🤔
          for (const [condition, pattern] of Object.entries(entry)) {
            let ok; // check if subpattern satisfied page.src

            if (
              (condition === "script" || (
                condition === "default" && opts.exportsDefault === "script"
              )) && (ok = globToRegExp(pattern).test(src))
            ) pkg.nomodule.add("." + src);

            if (
              (condition === "import" || condition === "script" || (
                condition === "default" && opts.exportsDefault != null
              )) && (ok ?? globToRegExp(pattern).test(src))
            ) {
              pkg.input.add("." + src);
              pkg.pages[
                (pkg.exports[dest] ??= {})[condition] = parse(src).name + ".js"
              ] = page;
              isPkg = true;
            }
          }
        }
      }
      if (!isPkg) nonPkg.input.push(src);
    }

    // TODO: resolve `import "npm:<pkg-name>"` to local-package
    return Promise.all(
      Object.entries(pkgs).map(([pkgName, { input, nomodule, pages }]) =>
        bundle([...input], nomodule, enableAllSourceMaps, all, pages, pkgName)
      ).concat(
        nonPkg.input.length &&
          bundle(nonPkg.input, nonPkg.nomodule, enableAllSourceMaps, all),
      ),
    );
  }).loadAssets(scriptExts);

  const bundle = async (
    input: string[],
    nonModules: Set<string>,
    sourcemap: OutputOptions["sourcemap"],
    write: Page[],
    pages: Record<string, Page> = {},
    outdir = ".",
  ) => {
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
            ...opts,
            target: "esnext",
            // BUG(rollup-plugin-esbuild): can't handle import from *.mts
            // include: /\.[mc]?[jt]sx?$/,
            // loader: { ".mts": "ts", ".ts": "ts" },
            // resolveExtensions: [".ts", ".mts"],
          }),
        ],
      } satisfies RollupOptions,

      output: {
        dir: join(config.outdir!, outdir),
        sourcemap,
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
      cache: outdir === "." ? cache : cachePkg[outdir],
      input,
      preserveEntrySignatures: "allow-extension",
    });
    if (outdir === ".") cache = build.cache;
    else cachePkg[outdir] = build.cache;

    const gen = await build.generate(cfg.output);
    for (const output of gen.output) {
      const outputPath = join(config.outdir!, output.fileName);
      // const bugs = ["current.js"] as const;
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
          // if (output.fileName === bugs[0]) { // TODO: create rollup plugin to handle this scenario
          //   const hash = code.match(/import.*from".\/registry-(.*).js/)![1];
          //   code = `export{event,value}from"./registry-${hash}.js";\n` +
          //     (config.sourcemap
          //       ? `//# sourceMappingURL=registry-${hash}.js.map\n`
          //       : "");
          // }
          let chunk;
          saveAsset(
            site,
            pages[output.fileName] ??
              (chunk = Page.create(join("/", outdir, output.fileName), "")),
            code,
            output.map,
          );
          if (chunk) write.push(chunk);
          break;
        }
        case "asset": {
          const asset = output.source;
          if (typeof asset === "string") {
            saveAsset(site, Page.create(outdir, asset), asset);
          } else Deno.writeFile(outputPath, asset);
          break;
        }
      }
    }
  };
};
