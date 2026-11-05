// The business's start point on the delivery maps, shared by the Google and
// Leaflet versions. A pin rather than a dot: its tip marks the spot, so a
// driver's "still at the depot" badge drawn there doesn't hide all of it.
export const START_ICON_WIDTH = 30;
export const START_ICON_HEIGHT = 38;

export const START_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${START_ICON_WIDTH}" height="${START_ICON_HEIGHT}" viewBox="0 0 30 38" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4))"><path d="M15 1C7.3 1 1 7.3 1 15c0 9.8 14 22 14 22s14-12.2 14-22C29 7.3 22.7 1 15 1z" fill="#0f172a" stroke="white" stroke-width="2"/><path d="M15 7.5 7.5 14v8h5v-5h5v5h5v-8z" fill="white"/></svg>`;
