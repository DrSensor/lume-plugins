import lume from "lume/mod.ts";
import babel from "../../babel.ts";

const site = lume();

site.use(babel());

export default site;
