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

### Gallery: Explore mode (3D sketchbook)

`features/gallery/explore/ExploreCanvas.tsx` (canvas, input, controls), `Sketchbook.tsx` (the book), `pageTextures.ts` (pages and cover drawn on canvases), and `sketchbook.ts` (the arithmetic and the paper model, unit-tested). Replaced the cylinder room in milestone 8b, after the owner found it overstimulating.

- **The book:** a sketchbook on a quiet desk, seen at a reader's angle (0.3 rad off vertical; the owner asked for less tilt than the first 0.45). One artwork per spread: the right page shows the piece whole, at its own proportions, as if tipped in; the left page has its caption (title, medium and year, credit) and its place in the book ("3 / 18"). Pages have a faint grain and darken softly into the spine.
  - **Which pieces:** only those the owner chose (`inSketchbook`; `"sketchbook": false` in `content/artworks.json` leaves one out). Black-and-white and coloured pieces alternate (`mixTones`).
  - Colours and fonts are read from `tokens.css` at run time, so the book follows the palette.
- **Opening:** every time Explore opens, the book appears closed (Ink cover, "Marigold & Ink" with a Marigold rule), rests **0.45 s**, then the front cover swings over the spine (**1.7 s**, ease-in-out) while the book glides to the middle of the view. The inside of the cover becomes the first caption page. Pages can't be turned until it's open (a turn asked for meanwhile happens right after).
- **Paper:** each page is a strip of 28 pieces from the spine to the edge. The spine end is driven by the turn; every piece follows its target on a spring (stiffness 15/s, loosening 72% toward the edge, damping ratio 0.82), so the edge lifts first, trails through the turn, and floats down last. Pieces stop at the stack rather than pass through it, and the paper never stretches (both tested). Parts of a page shade darker as they stand up.
  - **An animated turn** (scroll, keys, buttons) takes **1.1 s**, ease-in-out, with the edge led ahead early and trailing late.
  - **Dragging** holds the page: it follows the finger or mouse (about a page's width on screen takes it all the way over), edge leading. Let go past a third of the way, or with a flick (0.45 px/ms), and it carries on over with an ease-out; otherwise it falls back.
- **Input, one page at a time:**
  - **Scroll:** one page per gesture. A trackpad swipe and its coasting count as one; the next turn needs a pause of 220 ms. At the first or last page, scrolling carries on down the page.
  - **Drag or swipe** sideways, as above. Vertical swipes still scroll the page on phones (`touch-action: pan-y`).
  - **Keys:** ← →, Home, End; Enter opens the piece. **Buttons** below the book, with the title and "N of 18" (announced politely).
  - **Click** the open right-hand page to open the detail overlay (a drag isn't a click).
- **Phones** (portrait canvas): the camera frames the right-hand page, so one piece fills the stage; the caption is in the controls below.
- **Light on the GPU:** only leaves within two of the open spread get real page textures; the rest are blank paper until they come near. Resting pages aren't recomputed.
- **Lazy-loaded:** `React.lazy`, so three.js downloads only when Explore opens. (drei and postprocessing were dropped with the cylinder.)
- **Accessibility:** a visually hidden list of buttons offers every sketchbook piece to keyboards and screen readers.
- **Reduced motion:** never opened by default (Grid is used); if opened, the book starts open and pages change at once (a drag still moves the page with the finger).

### Giving: seed → sprout → tree

`features/giving/TreeMorph.tsx`, `features/giving/treeStages.ts` (built in milestone 8; ported from the original motion-v spec to Motion for React)

- **The drawing:** three single closed SVG paths on a 100 × 100 grid (seed, sprout, tree), in Ink, on a Marigold ground line.
- **The morph:** flubber interpolates seed → sprout and sprout → tree. Motion's `useScroll` tracks the drawing from entering the window to reaching its middle, and `useTransform` maps that progress to the path.
- **How far it grows:** up to the stage the trees funded so far have reached: a seed at 0, a sprout at **50** trees, a full tree at **200** (the owner's thresholds), partway in between. Below it: "N trees funded so far".
- **Loaded on demand:** the Giving route is lazy, so flubber (about 23 KB gzipped with the page) downloads only there.
- **Reduced motion:** no morph; the nearest whole stage fades in once.

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

When these are built, add their files here and move them into the section above.

## Testing

- **Unit:** the typewriter rhythm (`useTypewriter.test.ts`) and the sketchbook's arithmetic (`sketchbook.test.ts`: the paper model, turn and opening timing, dragging, one page per scroll gesture).
- **Page tests** run with animations skipped (`MotionGlobalConfig.skipAnimations`) and check behavior: slides change, dialogs open and close, URLs update.
- **Real browser:** jsdom has no layout, so shared-layout exits and WebGL are checked in a real browser. See the PR checklist: morph mid-flight at full strength, Escape and backdrop close, the sketchbook renders and turns one page per scroll gesture, phone has no horizontal overflow, reduced-motion fallbacks.
