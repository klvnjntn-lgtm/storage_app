'use client';

import { SOLUTIONS, heroBus, useHeroActive } from './solutions';

/* The four solutions under the hero copy. Each links to its panel; hovering
   or focusing one flies the 3D camera to that zone, and the chip for the zone
   the story is on lights up. Only this component re-renders as the story
   advances, not the whole page. */
export default function HeroChips({ labels }: { labels: Record<(typeof SOLUTIONS)[number]['key'], string> }) {
  const active = useHeroActive();
  return (
    <ul className="flex flex-wrap gap-2">
      {SOLUTIONS.map(({ key, icon: Icon, hex, rgb }) => {
        const on = active === key;
        return (
          <li key={key}>
            <a
              href={`#${key}`}
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') heroBus.focus = key;
              }}
              onPointerLeave={() => {
                heroBus.focus = null;
              }}
              onFocus={() => {
                heroBus.focus = key;
              }}
              onBlur={() => {
                heroBus.focus = null;
              }}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium text-white/85 transition-colors duration-300 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              style={{
                borderColor: `rgb(${rgb} / ${on ? 0.7 : 0.22})`,
                background: `rgb(${rgb} / ${on ? 0.16 : 0.05})`,
              }}
            >
              <Icon size={14} strokeWidth={2.2} aria-hidden="true" style={{ color: hex }} />
              {labels[key]}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
