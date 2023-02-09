import { Site } from "lume/core.ts";
import parseMakefile from "https://esm.sh/@kba/makefile-parser"; // TODO: replace with more correct parser (or make it yourself!)

export default (site: Site) => {
  site.process(["Makefile", ".mk"], (page) => {
    const make = parse(page.content as string);
    for (const [url, rule] of Object.entries(make.target.file)) {
    }
  });
};

export function parse(content: string): Makefile {
  const { PHONY, ast }: Line = parseMakefile(content);
  const result: Makefile = { target: { file: {} }, help: {} };
  if (PHONY.length) result.target.phony = {};
  const phony = new Set(PHONY);
  for (const line of ast) {
    if ("variable" in line) {
      (result.variable ??= {})[line.variable] = line.value;
      if (line.comment) {
        (result.help.variable ??= {})[line.variable] = line.comment;
      }
    } else if ("target" in line) {
      const { deps, recipe } = line;
      if (phony.has(line.target)) {
        (result.target.phony ??= {})[line.target] = { deps, recipe };
      } else result.target.file[line.target] = { deps, recipe };
      if (line.comment && (phony.size === 0 || phony.has(line.target))) {
        (result.help.target ??= {})[line.target] = line.comment;
      }
    }
  }
  return result;
}

export interface Makefile {
  help: Partial<Record<"target" | "variable", Record<string, string[]>>>;
  target: {
    phony?: Record<string, Omit<Rule, "comment" | "target">>;
    file: Record<string, Omit<Rule, "comment" | "target">>;
  };
  variable?: Record<string, Variable["value"]>;
}

interface Line {
  PHONY: string[];
  ast: (Empty | Variable | Rule)[];
  unhandled: `!! UNHANDLED: '${string}`[];
}

interface Empty {
  emptyLine: true;
}

interface MayHaveComments {
  comment?: string[];
}

interface Variable extends MayHaveComments {
  variable: string;
  value: string;
}

interface Rule extends MayHaveComments {
  target: string;
  deps: string[];
  recipe: string[];
}
