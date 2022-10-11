import * as babel from "./deps.ts";

export default {
  extensions: babel.DEFAULT_EXTENSIONS,
  sourceType: "unambiguous",
  presets: [babel.presetEnv],
  plugins: [
    babel.pluginTransformRuntime,
    [babel.pluginProposalDecorators, { version: "2022-03" }],
  ],
  targets: {
    esmodules: true,
    browsers: "unreleased Chrome versions",
  },
} as Options;

export interface Options extends babel.TransformOptions {
  /** Filter which file extensions should be transpiled by Babel.
  @see https://babeljs.io/docs/en/babel-core#default_extensions */
  extensions: string[];

  /** @see https://babeljs.io/docs/en/options#output-targets */
  targets?: // adding 👈 cuz somehow babel.InputOptions is missing 🤔
    | string
    | string[]
    | Partial<
      {
        esmodules: boolean;
        browsers: string | string[];
        node: string | "current" | true;
        safari: string | "tp";
      }
    >
    | Record<
      | "android"
      | "chrome"
      | "edge"
      | "electron"
      | "firefox"
      | "ie"
      | "ios"
      | "node"
      | "opera"
      | "rhino"
      | "safari"
      | "samsung",
      `${number}`
    >;
}
