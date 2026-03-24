import { WoxImage } from "@wox-launcher/wox-plugin"

export const WINDOW_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm3 1h.01M9 8h.01"/></svg>`

export const WINDOW_ICON: WoxImage = {
  ImageType: "svg",
  ImageData: WINDOW_ICON_SVG
}
