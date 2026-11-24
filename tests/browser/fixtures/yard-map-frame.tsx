import { hydrateRoot } from "react-dom/client";
import { z } from "zod";
import { YardMapFixture } from "./yard-map-app";

const root = document.getElementById("root");
const config = document.getElementById("config")?.textContent;
if (!root || !config)
  throw new Error("The yard map fixture page is missing #root or #config.");
const props = z
  .object({ width: z.number(), height: z.number() })
  .parse(JSON.parse(config));
hydrateRoot(root, <YardMapFixture {...props} />);
