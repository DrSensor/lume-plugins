import { merge } from "lume/core/utils.ts";
import { toFileUrl } from "lume/deps/path.ts";
import { prepareAsset } from "lume/plugins/source_maps.ts";

import type { Site } from "lume/core.ts";
import type { Options } from "./babel/options.ts";

import * as babel from "./babel/deps.ts";
import defaultOptions from "./babel/options.ts";

export default function (userOptions?: Partial<Options>) {
  let { extensions, ...babelOptions } = merge(defaultOptions, userOptions);
  if (userOptions?.plugins) {
    babelOptions.plugins!.unshift(...defaultOptions.plugins!);
  }
  babelOptions = babel.loadOptions(babelOptions)!;
  return (site: Site) => {
    site.loadAssets(extensions);
    site.process(extensions, async (page) => {
      const script = prepareAsset(site, page);

      // WARNING: Passing cached plugin instances is not supported in babel.loadPartialConfig()
      // const config = await babel.loadPartialConfigAsync(babelOptions!);
      // babelOptions = config!.options;

      if (script.enableSourceMap) {
        babelOptions.sourceMaps ??= true;
        babelOptions.sourceFileName = toFileUrl(script.filename).href;
      }

      const result = await babel.transformAsync(script.content, babelOptions)!;
      page.content = result!.code!;
      page.updateDest({ ext: ".js" });
    });
  };
}
