import type { Site } from "lume/core.ts";
import type { PackageJson } from "npm:pkg-types";
import { globToRegExp, isGlob } from "std/path/mod.ts";

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
  default?: "import" | "script";
}

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

  type Export = Partial<
    Record<"default" | "script" | "import", string | RegExp>
  >;
  type Package = {
    name?: string;
    private: boolean;
    exports: Map<string | RegExp, Export>;
  };
  const pkgAt = new Map<string, Package>();

  site.process(manifestExts, (page) => {
    if (page.src.slug !== "package") return;
    const pkg: PackageJson = JSON.parse(page.content as string);
    const register: Package = {
      name: pkg.name,
      private: !!pkg.private,
      exports: new Map(),
    };
    const { exports, name } = register;

    const script = pkg.main ?? pkg.browser;
    const default_ = pkg.type === "module" ? "import" : "default";
    // TODO: relative path -> project path
    if (!pkg.exports && !script) exports.set(".", { [default_]: "./index.js" });
    else if (typeof pkg.exports === "string") {
      exports.set(".", {
        ...script ? { import: pkg.exports, script } : { default: pkg.exports },
      });
    } else if (script) exports.set(".", { [default_]: script });
    else {
      for (const path in pkg.exports) {
        const $ = pkg.exports[path];
        if (typeof $ === "string") {
          exports.set(
            isGlob(path) ? globToRegExp(path) : path,
            { default: isGlob($) ? globToRegExp($) : $ },
          );
        } else {
          const routes: Export = {};
          for (const type in $) {
            let type_: "import" | "script" | "default" | undefined;
            switch (type) {
              case "import":
              case "script":
                type_ = type;
                break;
              case "default":
                type_ = default_; // BUG(typescript): can't auto infer `let` without type
            }
            if (!type_) continue;
            routes[type_] ??= isGlob($[type]) ? globToRegExp($[type]) : $[type];
          }
          exports.set(isGlob(path) ? globToRegExp(path) : path, routes);
        }
      }
    }

    pkgAt.set(page.src.path, register);
    callbackStack.pop()?.({ exports, name }, page.src.path);
  }).loadAssets(manifestExts);

  type Callback = (pkg: Omit<Package, "private">, path: string) => void;
  let callbackStack: Array<Callback> = [];
  site.addEventListener("beforeSave", () => callbackStack = []);

  site.hooks.forEachPackage = (callback: Callback) => {
    callbackStack.push(callback);
    for (const [path, { name, private: isPrivate, exports }] of pkgAt) {
      if (!name || (isPrivate && opts.excludePrivate)) continue;
      callbackStack.pop()?.({ exports, name }, path);
    }
  };
};
