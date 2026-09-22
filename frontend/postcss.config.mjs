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

const config = {
  plugins: ["@tailwindcss/postcss", srgbColorMix()],
};

export default config;
