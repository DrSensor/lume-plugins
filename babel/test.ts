import type { SiteOptions } from "lume/core.ts";
import lume from "lume/mod.ts";
import * as path from "std/path/mod.ts";
import * as test from "../testing.ts";
import babel from "../babel.ts";

const cwd = path.fromFileUrl(import.meta.resolve("./"));
const options: Partial<SiteOptions> = {
  cwd: path.join(cwd, "demo"),
  quiet: true,
};

Deno.test("babel plugin", async (t) => {
  const site = lume(options);

  site.use(babel());

  await test.build(site);
  await test.assertSiteSnapshot(t, site);
});
