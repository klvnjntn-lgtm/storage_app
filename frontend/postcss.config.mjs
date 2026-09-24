// Tailwind v4 compiles every `/NN` opacity modifier (bg-white/15,
// border-blue-500/20, ring-white/10, ...) to `color-mix(in oklab, ...)`,
// independent of whether the underlying --color-* token is hex or oklch.
// Some older GPUs/drivers mishandle Lab-family color math (same class of
// bug as the oklch hex fallback in globals.css) and render these as solid
// white. Rewriting the interpolation space to plain srgb keeps the same
// color-mix() structure but drops the Lab math those devices choke on.
//
// Defined inline (not required from a separate file) and passed as an
// already-built plugin instance — "@tailwindcss/postcss" stays a bare
// string so Turbopack resolves it the same way it does today, instead of
// pulling its native lightningcss dependency into Turbopack's own bundle
// graph (which broke the build when this was a static top-level import).
function srgbColorMix() {
  return {
    postcssPlugin: "srgb-color-mix",
    Declaration(decl) {
      if (decl.value.includes("oklab")) {
        decl.value = decl.value.replaceAll("in oklab", "in srgb");
      }
    },
  };
}
srgbColorMix.postcss = true;

// Belt-and-suspenders for the same class of device as above: this one
// doesn't choke on oklab specifically, it doesn't understand the
// color-mix() *function* at all (color-mix() only shipped in
// Chrome 111 / Firefox 113 / Safari 16.2, so a genuinely old browser on
// an old PC predates it outright). Tailwind's own `/NN` opacity output is
// entirely color-mix()-based — base tier and the srgb-rewritten
// @supports tier alike — so on such a browser BOTH declarations are
// invalid and the property is left unset, i.e. no color, not even the
// oklch hex fallback's color. A plain rgba() declaration understands no
// such function and is universally supported, so it's inserted *before*
// Tailwind's color-mix() declaration: browsers that can't parse
// color-mix() silently keep this rgba() value (an unparseable
// declaration never overrides the prior valid one), while every other
// browser overwrites it with the color-mix() line right after, same as
// today.
function colorMixRgbaFallback() {
  const COLOR_MIX_RE =
    /^color-mix\(in srgb, (#[0-9a-fA-F]{3,8}) (\d+(?:\.\d+)?)%, transparent\)$/;

  function hexToRgb(hex) {
    let h = hex.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6) return null;
    const num = parseInt(h, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  return {
    postcssPlugin: "color-mix-rgba-fallback",
    Declaration(decl) {
      const match = decl.value.match(COLOR_MIX_RE);
      if (!match) return;
      const [, hex, pct] = match;
      const rgb = hexToRgb(hex);
      if (!rgb) return;
      const alpha = Number(pct) / 100;
      decl.cloneBefore({ value: `rgba(${rgb.join(", ")}, ${alpha})` });
    },
  };
}
colorMixRgbaFallback.postcss = true;

const config = {
  plugins: ["@tailwindcss/postcss", srgbColorMix(), colorMixRgbaFallback()],
};

export default config;
