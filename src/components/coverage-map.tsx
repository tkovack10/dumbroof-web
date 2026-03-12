"use client";

// US state paths for SVG coverage map
const STATE_PATHS: Record<string, string> = {
  AL: "M628,466 L627,512 L618,512 L617,524 L636,530 L645,526 L649,468 Z",
  AK: "M161,485 L183,485 L183,510 L161,510 Z",
  AZ: "M205,410 L204,472 L248,485 L262,437 L252,408 Z",
  AR: "M556,432 L611,430 L614,467 L555,470 Z",
  CA: "M120,310 L142,310 L170,370 L185,430 L168,478 L130,470 L105,410 L105,350 Z",
  CO: "M290,340 L370,340 L370,400 L290,400 Z",
  CT: "M820,230 L845,223 L850,245 L825,248 Z",
  DE: "M783,310 L796,305 L798,330 L785,332 Z",
  FL: "M645,530 L690,510 L728,540 L730,570 L700,610 L673,590 L650,548 Z",
  GA: "M650,467 L700,460 L710,510 L690,510 L645,526 Z",
  HI: "M260,520 L285,520 L285,545 L260,545 Z",
  ID: "M215,200 L260,200 L260,320 L230,320 L215,280 Z",
  IL: "M590,290 L620,290 L625,390 L595,395 L580,360 Z",
  IN: "M625,290 L660,290 L660,390 L625,390 Z",
  IA: "M510,270 L590,270 L590,330 L510,330 Z",
  KS: "M390,360 L505,360 L505,415 L390,415 Z",
  KY: "M622,385 L720,365 L720,400 L622,410 Z",
  LA: "M555,490 L610,480 L620,530 L575,540 L555,525 Z",
  ME: "M845,130 L870,120 L885,170 L855,190 Z",
  MD: "M740,310 L790,300 L795,330 L740,340 Z",
  MA: "M820,210 L860,200 L863,218 L825,225 Z",
  MI: "M610,190 L665,180 L680,270 L640,280 L625,245 L610,260 Z",
  MN: "M480,150 L555,150 L555,260 L480,260 Z",
  MS: "M595,465 L625,465 L627,530 L595,535 Z",
  MO: "M510,340 L590,340 L595,430 L555,432 L520,430 L510,400 Z",
  MT: "M245,140 L370,140 L370,220 L245,220 Z",
  NE: "M370,290 L505,290 L505,350 L390,350 L370,330 Z",
  NV: "M165,260 L220,260 L220,400 L190,420 L165,370 Z",
  NH: "M835,155 L850,150 L855,200 L840,205 Z",
  NJ: "M790,265 L805,260 L810,310 L795,315 Z",
  NM: "M255,410 L340,405 L345,490 L255,495 Z",
  NY: "M740,185 L820,175 L830,250 L790,260 L740,240 Z",
  NC: "M660,400 L780,380 L790,410 L660,430 Z",
  ND: "M380,145 L475,145 L475,220 L380,220 Z",
  OH: "M660,285 L720,280 L730,360 L670,370 Z",
  OK: "M380,415 L505,410 L510,440 L520,440 L520,470 L380,475 Z",
  OR: "M115,185 L215,185 L215,260 L165,260 L115,240 Z",
  PA: "M720,245 L800,235 L795,300 L720,310 Z",
  RI: "M845,225 L858,222 L860,238 L847,240 Z",
  SC: "M680,430 L740,415 L750,450 L700,460 Z",
  SD: "M380,220 L475,220 L475,290 L380,290 Z",
  TN: "M610,405 L720,395 L722,425 L612,435 Z",
  TX: "M350,470 L460,450 L520,470 L530,540 L490,590 L420,590 L370,550 L340,510 Z",
  UT: "M230,280 L290,280 L290,400 L250,408 L230,370 Z",
  VT: "M820,160 L835,155 L838,205 L823,208 Z",
  VA: "M680,350 L780,340 L790,380 L680,400 Z",
  WA: "M130,120 L220,120 L220,195 L130,195 Z",
  WV: "M700,320 L740,310 L745,370 L720,380 L700,360 Z",
  WI: "M540,170 L600,160 L610,260 L540,270 Z",
  WY: "M270,220 L370,220 L370,300 L270,300 Z",
  DC: "M770,320 L778,318 L780,325 L772,327 Z",
};

interface CoverageMapProps {
  activeStates: string[];
  title?: string;
}

export function CoverageMap({ activeStates, title }: CoverageMapProps) {
  const activeSet = new Set(activeStates.map(s => s.toUpperCase()));

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      {title && (
        <h3 className="text-lg font-bold text-[var(--navy)] mb-4 text-center">{title}</h3>
      )}
      <svg viewBox="100 100 810 520" className="w-full max-w-2xl mx-auto">
        {Object.entries(STATE_PATHS).map(([code, path]) => (
          <path
            key={code}
            d={path}
            className={
              activeSet.has(code)
                ? "fill-[var(--navy)] stroke-white stroke-[1.5] opacity-80 hover:opacity-100 transition-opacity cursor-pointer"
                : "fill-gray-200 stroke-white stroke-[1.5] hover:fill-gray-300 transition-colors cursor-pointer"
            }
          >
            <title>{code}{activeSet.has(code) ? " — Active coverage" : ""}</title>
          </path>
        ))}
      </svg>
      <div className="flex items-center justify-center gap-6 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 rounded-sm bg-[var(--navy)] opacity-80" />
          <span className="text-xs text-gray-600">Active coverage</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 rounded-sm bg-gray-200" />
          <span className="text-xs text-gray-600">Coming soon</span>
        </div>
      </div>
    </div>
  );
}
