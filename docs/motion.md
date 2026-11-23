# Motion map

Every animation on the site: where it lives, how it behaves, what it does under reduced motion, and its status. Motion should feel calm and handmade, never busy. Shared rules come first.

## Rules everywhere

- **Library:** [Motion](https://motion.dev) (`motion/react`) for component animation; plain CSS for small hover and focus effects; React Three Fiber for the 3D gallery.
- **Easing:** `cubic-bezier(0.4, 0, 0.2, 1)` (`--ease-standard` in `tokens.css`, `EASE` in code) unless noted.
- **Reduced motion:** every animation checks the visitor's OS setting (`usePrefersReducedMotion`, plus `<MotionConfig reducedMotion="user">` at the root):
  - the gallery opens in Grid instead of 3D;
  - the typewriter shows its text without typing;
  - no confetti;
  - slides and morphs become simple fades.
- **Route changes:** only a quick fade-in of the new page (0.2s). See "Route changes" below for why there is no fade-out.
- **Typed code:** props, refs (`useRef<Group>(null)`), and Motion `Variants` are all typed. Libraries without types get declarations in `client/src/types/` when they're added (flubber, possibly canvas-confetti).
- **Real content:** wherever an original spec used Unsplash images or mock data, the site uses the real artworks from the gallery API.
- **Accessibility:** animated text is hidden from screen readers (`aria-hidden`) and the full text is given once as plain text; carousels announce slide changes politely; dialogs move focus in and back.

## Built in milestone 5

### Home: typewriter hero

`features/home/Hero.tsx`, `hooks/useTypewriter.ts`

- One line at a time on **CSS-only notebook paper**:
  - ruled lines are a repeating gradient;
  - the margin line and binder holes are gradients too;
  - the text's line-height equals the rule spacing, so letters sit on the lines.
- Typed in Special Elite with a blinking **Marigold cursor**.
- **Rhythm** (`TIMING` in `useTypewriter.ts`):

  | Phase | Timing |
  | --- | --- |
  | Typing | 55–125 ms per character, +90 ms after a space or punctuation |
  | Hold the finished line | 1.8 s |
  | Erasing (faster than typing) | 28–46 ms per character |
  | Pause before the next line | 0.45 s |

- If the lines change, whatever is on screen is erased and the new text typed.
- The logic is a pure step function (`nextStep`), unit-tested without timers.
- **Reduced motion:** the first line is shown at once and the cursor doesn't blink.
- Copy: `client/src/content/copy.ts` (`heroLines`, currently placeholders).

### Home: featured-work carousel

`features/home/FeaturedCarousel.tsx`

- 5 published artworks: the first five once black-and-white and coloured pieces are mixed (`features/gallery/mixTones.ts`), since the gallery's own order puts black and white first. Up to 84% of the window's height on desktop (max 56rem). **No autoplay:** visitors move it with the arrows, the arrow keys, or a swipe (drag past 60px).
- **Three layers per slide**, with these timings:

  | Layer | Arriving | Leaving |
  | --- | --- | --- |
  | Background (the artwork blurred, under an Ink gradient) | fades and scales 1.08 → 1, 0.8 s | fades, after 0.2 s |
  | Artwork | slides from the right, 0.6 s, after 0.2 s | slides out, after 0.1 s |
  | Text | drops in from above, 0.5 s, after 0.4 s | first out, 0.25 s |

  The leaving order is text → artwork → background.
- **Previous** mirrors every direction. `usePresenceData` gives a leaving slide the *current* direction, so it exits the right way even if the visitor changed direction.
- **Controls:**
  - custom arrow buttons: on hover the circle fills with Marigold and the arrow nudges 3px its way; it presses in on click;
  - a Marigold progress bar with a `01 / 05` counter.
- **Reduced motion:** every layer just fades; swipe is off.

### Gallery: Grid mode, with shared-layout detail view

`features/gallery/GalleryGrid.tsx`, `ArtworkOverlay.tsx` (originally specified in Vue; built in React)

- **When it's the default:** on narrow screens (under 64rem) and with reduced motion. Visitors can always switch with the Grid / Explore toggle.
- **The morph:** clicking a card **morphs** it into a full-screen view.
  - The card's image and the overlay's image share a `layoutId`, so Motion animates one into the other (0.45 s).
  - Details fade in after the morph (0.3 s, after 0.3 s).
  - `layoutCrossfade={false}` keeps the image at full strength while it travels.
  - Only the Ink backdrop fades.
- **Closing:** the close button, **Escape**, or a click on the backdrop. The page behind can't scroll (`useScrollLock`).
- **In the URL:** `?art=slug`, so a view can be shared and Back closes it.
- **Hover:** the card image scales 1.03.
- **Layout (milestone 7e):** justified rows. Each image is shown whole at its own proportions (never cropped), and every row fills the width: a card's flex basis is its ratio × the row height (11rem on phones, 14rem, then 17rem), and it grows by its ratio, so a row's images share one height. Reading order stays left to right, so black-and-white pieces, which come first, read first.
- **Reduced motion:** no morph (no `layoutId`); the overlay fades.

### Gallery: Explore mode (3D)

`features/gallery/explore/ExploreCanvas.tsx` (canvas, input) and `ExploreScene.tsx` (meshes); the layout is in `layout.ts`

- **The room:** artworks on the inside of a cylinder (radius 5), facing the camera at its center, in two staggered rows.
  - A small collection repeats around the room (at least 9 per row); copies of a piece sit evenly apart and never side by side.
  - Each card shows its whole image at its own proportions (never cropped).
  - **Mixed tones (milestone 7e):** black-and-white and coloured pieces are spread evenly through each other (`features/gallery/mixTones.ts`), so neither kind bunches up.
- **Turning:** the wheel (captured over the scene only), dragging, or the arrow keys set a target angle. Every frame, `useFrame` eases the cylinder toward it with frame-rate-independent lerp (`1 − e^(−6·Δt)`).
- **Hover:** a card scales to 1.08, brightens, and tilts toward the cursor, all eased per frame.
- **Click:** a card opens the same detail overlay as Grid mode.
- **Subtle depth of field:** `@react-three/postprocessing` `DepthOfField`, focused at the cylinder wall.
- **Lazy-loaded:** `React.lazy`, so three.js (about 285 KB gzipped) downloads only when Explore opens.
- **Accessibility:** a visually hidden list of buttons offers the same pieces to keyboards and screen readers.
- **Reduced motion:** never opened by default; Grid is used.

### About: ink-spread reveal

`features/about/InkReveal.tsx`

- The main photo is revealed through an irregular **ink blot** (an SVG CSS mask) that spreads from the center.
- It plays **once**, the first time the photo is 35% in view (1.6 s, ease-out).
- Motion animates the CSS variable `--ink` from 0 to 1; CSS turns that into `mask-size`.
- The closing photo at the bottom fades in when scrolled into view.
- **Reduced motion:** a plain fade.

### Route changes

`components/Layout.tsx`

- The new page fades in over 0.2 s.
- **Deviation from "crossfade":** a fade-*out* would keep the old page mounted while the URL has already changed, and the old page then re-renders against the new URL.
  - In testing, that sent the login guard into a redirect loop (`/login?next=/login?next=…`).
  - A fade-in alone gives the same calm feel without that class of bug.

### Micro-interactions (CSS)

- **Buttons:** lift 1px on hover.
- **Links:** Marigold underline; it darkens to Ink on hover.
- **Gallery filters:** chips fill with Marigold when active.
- **Focus:** an Ink ring wrapped in Marigold on every focusable element.
- **Loading:** a pulsing Marigold dot (still under reduced motion).

## Later milestones

| Where | Animation | Reduced motion |
| --- | --- | --- |
| Commission form | Steps slide in the direction of travel (next → from the right, back → from the left). | Fade between steps |
| Commission form | The quote total animates between values as options change (counting tween). | Value changes at once |
| Shop | Quick view opens from the product card with a shared layout (`layoutId`), like the gallery. | Fade |
| Order confirmation | Confetti in palette colors (Marigold, Ink, Rule, White), **once** per order (canvas-confetti). | No confetti |
| Giving page | An SVG path morphs **seed → sprout → tree** as the visitor scrolls: flubber interpolates the paths, and Motion's `useTransform` maps scroll progress to the morph (ported from the original motion-v spec). | The three stages shown as still images |

When these are built, add their files here and move them into the section above.

## Testing

- **Unit:** the typewriter rhythm (`useTypewriter.test.ts`) and the Explore layout (`layout.test.ts`).
- **Page tests** run with animations skipped (`MotionGlobalConfig.skipAnimations`) and check behavior: slides change, dialogs open and close, URLs update.
- **Real browser:** jsdom has no layout, so shared-layout exits and WebGL are checked in a real browser. See the PR checklist: morph mid-flight at full strength, Escape and backdrop close, 3D renders and turns without scrolling the page, phone has no horizontal overflow, reduced-motion fallbacks.
