import type { Page, Site, SourceMap } from "lume/core.ts";
import { assertSnapshot } from "std/testing/snapshot.ts";
import { basename } from "std/path/mod.ts";
import { printError } from "lume/core/errors.ts";

const cwUrl = import.meta.resolve("./");

/** Build a site and print errors */
export async function build(site: Site) {
  site.addEventListener("beforeSave", () => false); // Don't save the site to disk
  try {
    await site.build();
  } catch (error) {
    printError(error);
    throw error;
  }
}

function normalizeContent(
  content: string | Uint8Array | undefined,
): string | undefined {
  if (content instanceof Uint8Array) {
    return `Uint8Array(${content.length})`;
  }
  if (typeof content === "string") {
    return content // Normalize line ending for Windows
      .replaceAll("\r\n", "\n")
      .replaceAll(/base64,[^"]+/g, "base64,(...)");
  }
}

async function assertPageSnapshot(
  context: Deno.TestContext,
  page: Page,
) {
  let { data } = page;
  const { dest, src, content } = page;

  // Sort data alphabetically
  const entries = Object.entries(data).sort((a, b) => a[0].localeCompare(b[0]));
  data = Object.fromEntries(entries);

  await assertSnapshot(context, { src, dest, data, content });
}

export async function assertSiteSnapshot(
  context: Deno.TestContext,
  site: Site,
) {
  const { pages, files } = site;

  // Test number of pages
  await assertSnapshot(context, pages.length);

  // TODO: test site configuration
  await assertSnapshot(
    context,
    {
      formats: Array.from(site.formats.entries.values()).map((format) => {
        return {
          ...format,
          engines: format.engines?.length,
        };
      }),
    },
  );

  // Sort pages and files alphabetically
  pages.sort((a, b) => {
    return compare(a.src.path, b.src.path) || compare(a.dest.path, b.dest.path);
  });

  files.sort((a, b) => {
    return compare(a.src, b.src);
  });

  // Normalize some dynamic data
  pages.forEach((page) => {
    // Normalize data
    if (page.data.date instanceof Date) {
      page.data.date = new Date(0);
    }
    // Ignore comp object
    if (page.data.comp) {
      page.data.comp = {};
    }
    // Remove page reference
    page.data.page = undefined;

    // Normalize source maps
    if (page.data.sourceMap) {
      normalizeSourceMap(page.data.sourceMap as SourceMap);
    }

    // Remove pagination results details from the data
    if (Array.isArray(page.data.results)) {
      page.data.results = page.data.results.length;
    }
    // Remove alternates values (added by multilanguage plugin)
    if (page.data.alternates) {
      page.data.alternates = Object.keys(
        page.data.alternates as Record<string, Page>,
      );
    }
    // Remote base path because it's different in the test environment
    page.src.remote = page.src.remote?.replace(cwUrl, "");
    delete page.src.created;
    delete page.src.lastModified;

    // Normalize content for Windows
    page.content = normalizeContent(page.content);
    page.data.content = normalizeContent(
      page.data.content as string | Uint8Array | undefined,
    );

    // Source maps
    if (page.dest.ext === ".map") {
      const map = JSON.parse(page.content as string);
      normalizeSourceMap(map);
      page.content = JSON.stringify(map);
      page.data.content = JSON.stringify(map);
    }
  });

  // Test static files
  await assertSnapshot(
    context,
    files.map((file) => {
      // Remote base path because it's different in the test environment
      file.remote = file.remote?.replace(cwUrl, "");
      return file;
    }),
  );

  // Test pages
  for (const page of pages) {
    await assertPageSnapshot(context, page);
  }
}

function compare(a: string, b: string): number {
  return a > b ? 1 : a < b ? -1 : 0;
}

function normalizeSourceMap(sourceMap: SourceMap) {
  sourceMap.sourceRoot = sourceMap.sourceRoot
    ? basename(sourceMap.sourceRoot)
    : undefined;
  sourceMap.file = sourceMap.file ? basename(sourceMap.file) : undefined;
  sourceMap.sources = sourceMap.sources.map((source: string) =>
    basename(source)
  );
}
