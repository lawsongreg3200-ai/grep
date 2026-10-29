/**
 * Convex looks for `convex/http.ts` and mounts its default export as the HTTP
 * router. The routes themselves live in `convex/watch.ts` (auth + the watcher +
 * the REST surface) — this file is only the mount point.
 */
import { deeboRouter } from "./watch";

export default deeboRouter;
