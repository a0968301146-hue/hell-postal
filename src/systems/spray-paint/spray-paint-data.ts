/** Centralized tuning + color palette for the spray paint tool ("Fix pallet
 * throw and add spray paint tool" round spec五: "顏色集中定義...價格集中定義
 * 便於未來調整" — this round's own analogous instruction for the spray tool
 * — spray-paint-system.ts reads every one of these, never hardcodes its own
 * copy). Cycle order below is the exact order spec五 lists: 黃→紅→藍→綠→橘
 * →紫, index 0 (yellow) is every new spot's starting color. */
export const SPRAY_COLORS: { name: string; hex: number }[] = [
  { name: '黃色', hex: 0xf0c419 },
  { name: '紅色', hex: 0xe0433d },
  { name: '藍色', hex: 0x3d7de0 },
  { name: '綠色', hex: 0x4dbd5c },
  { name: '橘色', hex: 0xe08a33 },
  { name: '紫色', hex: 0x9a4de0 },
];

/** Square footprint (meters) — spec五: "初始尺寸：2.0m × 2.0m". */
export const SPRAY_SIZE = 2.0;

/** Degrees rotated per wheel notch while aiming — spec五: "滾輪每格左右旋轉
 * 15°" (same convention as PickupSystem's own placement rotation). */
export const SPRAY_ROTATE_STEP_DEG = 15;

/** How far above the floor hit point the plane sits — spec五: "上浮約0.01m
 * 避免閃爍" (matches the old floor-zone decals' own epsilon lift). */
export const SPRAY_SURFACE_LIFT = 0.01;

/** Minimum "how upward-facing must the hit surface's normal be" to count as
 * valid warehouse floor — spec五: "只允許水平或接近水平的倉庫地板". Reuses
 * the exact same 0.9 threshold PickupSystem.updatePlacementPreview() already
 * uses for its own "is this surface flat enough" rejection, for consistency. */
export const SPRAY_MAX_NORMAL_TILT = 0.9;
