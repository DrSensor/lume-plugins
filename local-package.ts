import type { Site } from "lume/core.ts";
import type { PackageJson } from "npm:pkg-types";
import { dirname, isGlob, join, joinGlobs } from "std/path/mod.ts";

export interface Options {
  /** Treat npm:package as local package
   * @default true
   */
  npmPrefix?: boolean;

  /** Treat package from CDN as local package
   * @default ["esm.run", "esm.sh", "cdn.skypack.dev", "ga.jspm.io/npm:", "jspm.dev"],
   */
  cdn?: string[];

  /** Glob string of excluded package.
   * This is useful if you want to explicitly use CDN or npm:package
   * @example
   * ```js
   * site.use(localPackage(exlcudes: ["pkg-b"]))
   * ```
   * assuming that package.json#name === basename
   * ```
   * .
   * ├── _config.js
   * ├── deno.json
   * ├── index.html
   * ├── pkg-a
   * │   ├── index.js
   * │   └── package.json
   * └── pkg-b ---------- excluded! use npm:pkg-b or //esm.run/pkg-b
   *    ├── index.js
   *    └── package.json
   * ```
   */
  excludes?: string[];

  /** Excluded if package.json { private:true } */
  excludePrivate?: boolean;

  /** How to treat `"default"` exports condition when package.json `{"type":"module"}` not specified.
   * It determine if the `<script>` require attribute `type=module` or not.
   */
  default?: condition;
}

/** @see https://webpack.js.org/guides/package-exports/#conditions for the keys */
export type Export = Record<condition | string, string>;
type condition = "import" | "script" | "types" | "asset" | "style" | "sass";
export type Exports = Record<string, Export | null>;
export type PackageExports = Record<"exacts" | "patterns", Exports>;

const manifestExts = [".json"];

const defaultOptions = {
  npmPrefix: true,
  cdn: ["esm.run", "esm.sh", "cdn.skypack.dev", "ga.jspm.io/npm:", "jspm.dev"],
} satisfies Options;

export default (opts: Options = defaultOptions) => (site: Site) => {
  let entries: Map<string, string> | undefined, kinds: string[] | undefined;
  site.hooks.importmapEntries = (
    inputs: typeof entries,
    types: typeof kinds,
  ) => void (entries = inputs, kinds = types);

  type Pkg = [name: string, exports: PackageExports, isPrivate?: boolean];
  const pkgs: Pkg[] = [];

  site.process(manifestExts, (page) => {
    if (page.src.slug !== "package") return;
    const pkg: PackageJson = JSON.parse(page.content as string);
    if (!pkg.name || (pkg.private && opts.excludePrivate)) return;
    const exports: PackageExports = { exacts: {}, patterns: {} };
    const root = dirname(page.src.path);

    const script = pkg.main ?? pkg.browser;
    const default_ = pkg.type === "module" ? "import" : "default";
    let resolve = (path: string) => join(root, path);

    if (!pkg.exports && !script) {
      (exports.exacts["."] ??= {})[default_] = resolve("./index.js");
    } else if (typeof pkg.exports === "string") {
      const e = exports.exacts["."] ??= {};
      if (script) {
        e.import = pkg.exports;
        e.script = script;
      } else e.default = resolve(pkg.exports);
    } else if (script) {
      (exports.exacts["."] ??= {})[default_] = resolve(script);
    } else {
      for (const path in pkg.exports) {
        let e;
        if (isGlob(path)) {
          e = exports.patterns[path] ??= {};
          resolve = (path_: string) => joinGlobs([root, path_]);
        } else e = exports.exacts[path] ??= {};

        const $ = pkg.exports[path];
        if (typeof $ === "string") e.default = resolve($);
        else {
          for (const type in $) {
            e[type === "default" ? default_ : type] ??= resolve($[type]);
          }
        }
      }
    }

    pkgs.push([pkg.name, exports, pkg.private]);
    callbackStack.pop()?.(...pkgs.pop()!);
  }).loadAssets(manifestExts);

  type Callback = (
    name: string,
    exports: PackageExports,
    isPrivate?: boolean,
  ) => void;
  let callbackStack: Array<Callback> = [];
  site.addEventListener("beforeSave", () => callbackStack = []);

  site.hooks.forEachPackage = (callback: Callback) => {
    callbackStack.push(callback);
    let args; // deno-lint-ignore no-cond-assign
    while (args = pkgs.pop()) callbackStack.pop()?.(...args);
  };
};
