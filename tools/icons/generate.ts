import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUTPUT, renderIconsCss } from "./icons.ts";

const root = join(import.meta.dirname, "../..");

writeFileSync(join(root, OUTPUT), renderIconsCss(root));
