### Milysec Jelly Playground

A WebGPU + Three.js soft‑body playground featuring a bouncy, translucent Milysec logo you can grab, stretch, throw, hop, and walk around a table.

- Engine: Three.js WebGPURenderer, TypeScript, Vite
- Physics: lightweight CPU XPBD soft‑body (tetrahedral lattice), skinned render mesh
- Visuals: mint jelly transmission with purple colon dots

Credit: Inspired by scottstts/Jelly-Baby (architecture, controls, and playful physics feel) — this is a clean re‑implementation tailored for Milysec branding with no jelly-baby assets or code.

#### Install
```bash
npm install
```

#### Develop
```bash
npm run dev
```
Open the local URL in a recent Chrome/Edge with WebGPU enabled (usually on by default).

#### Build
```bash
npm run build
npm run preview  # optional serve
```

#### Controls
- Grab and drag: left mouse/touch to stretch/throw
- Orbit: right-drag or two-finger drag
- Zoom: mouse wheel or pinch
- Move: WASD or Arrow keys (camera-relative)
- Hop: Space
- Reset: R
- Mobile: on-screen joystick (bottom-left)

#### Brand sources
- Mint: `#08D592`, Purple: `#9C32DF`, Near-black: `#070A08`
- Primary mark SVG (`public/assets/milysec.svg`) used to derive geometry and colours

#### Notes
- The soft body is a tetrahedral lattice fit to a rounded-square slab; a skinned high‑res slab mesh renders the mint transmission with purple dot inlays.
- Audio “thumps” are generated procedurally on contact intensity.

