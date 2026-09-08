import { projectYardLocation, type YardMapView } from "./yard-map-projection";

export function yardTileProvider(x: number, y: number, zoom: number) {
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

export function getYardMapTileUrls(
  view: YardMapView,
  width: number,
  height: number,
  highDensity: boolean,
) {
  // Match Pigeon's rounded tile zoom and fractional viewport scale.
  const zoom = Math.round(view.zoom);
  const scale = 2 ** (view.zoom - zoom);
  const center = projectYardLocation({
    lat: view.center[0],
    lng: view.center[1],
  });
  const tileX = (center.x / 1024) * 2 ** zoom;
  const tileY = (center.y / 1024) * 2 ** zoom;
  const left = Math.max(0, Math.floor(tileX - width / scale / 512));
  const right = Math.min(
    2 ** zoom - 1,
    Math.floor(tileX + width / scale / 512),
  );
  const top = Math.max(0, Math.floor(tileY - height / scale / 512));
  const bottom = Math.min(
    2 ** zoom - 1,
    Math.floor(tileY + height / scale / 512),
  );
  const urls: string[] = [];
  for (let x = left; x <= right; x++) {
    for (let y = top; y <= bottom; y++) {
      if (highDensity) {
        for (let part = 0; part < 4; part++) {
          urls.push(
            yardTileProvider(
              x * 2 + (part % 2),
              y * 2 + Math.floor(part / 2),
              zoom + 1,
            ),
          );
        }
      } else {
        urls.push(yardTileProvider(x, y, zoom));
      }
    }
  }
  return urls;
}

export function loadYardMapTile(
  url: string,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const image = new Image();
    const finish = (loaded: boolean) => {
      signal.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
      resolve(loaded);
    };
    const abort = () => {
      finish(false);
      image.removeAttribute("src");
    };
    signal.addEventListener("abort", abort, { once: true });
    image.onload = () => {
      void image.decode().then(
        () => finish(true),
        () => finish(false),
      );
    };
    image.onerror = () => finish(false);
    image.src = url;
  });
}
