// Fonts available for titles. Bundled fonts are OFL-licensed (see docs/LICENSES.md)
// and work offline; system fonts are used when installed.
export interface FontDef {
  family: string;
  weights: number[];
  arabic: boolean;
  bundled: boolean;
}

export const FONTS: FontDef[] = [
  { family: "Cairo", weights: [400, 600, 700, 900], arabic: true, bundled: true },
  { family: "Tajawal", weights: [400, 700, 900], arabic: true, bundled: true },
  { family: "Amiri", weights: [400, 700], arabic: true, bundled: true },
  { family: "Noto Naskh Arabic", weights: [400, 700], arabic: true, bundled: true },
  { family: "Inter", weights: [400, 500, 600, 700], arabic: false, bundled: true },
  { family: "Bebas Neue", weights: [400], arabic: false, bundled: true },
  { family: "Playfair Display", weights: [400, 700], arabic: false, bundled: true },
  { family: "Segoe UI", weights: [400, 600, 700], arabic: true, bundled: false },
  { family: "Tahoma", weights: [400, 700], arabic: true, bundled: false },
  { family: "Arial", weights: [400, 700], arabic: true, bundled: false },
  { family: "Times New Roman", weights: [400, 700], arabic: true, bundled: false },
  { family: "Georgia", weights: [400, 700], arabic: false, bundled: false },
  { family: "Impact", weights: [400], arabic: false, bundled: false },
  { family: "Courier New", weights: [400, 700], arabic: false, bundled: false },
];
