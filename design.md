# VitalGrid design

This file sets the visual direction for the VitalGrid website (homepage and dashboard). Every UI change follows it. If a change needs to break a rule here, update this file first.

The architecture and plan are final (`IMPLEMENTATION_PLAN.md`, `README.md`). The frontend is the React + Vite app in `dashboard/` with four views: `/` homepage, `#/twin` floor plan, `#/3d` building model, and `#/compare` results.

---

## 1. Brief

| | |
|---|---|
| **Subject** | A digital twin of an ICU's critical infrastructure: power, network, medical gases and room climate. It predicts which equipment a fault will reach, checks each prediction against engineering rules, and explains it in plain language. |
| **Audience** | Judges and faculty at the Avishkar convention (Medicine and Pharmacy), clinicians, and biomedical or facility engineers. They are smart, short on time, and not ML specialists. |
| **Primary job** | In ten seconds, show that one failing machine silently takes others down with it, and that VitalGrid sees the chain coming. Then get them into the live twin to cause a fault themselves. |
| **Feeling** | Calm, exact and clinical: an instrument you would trust at 3 a.m. Never a sci-fi "AI" dashboard. |

## 2. Concept: the building is the interface

Most AI demos show a graph of dots. VitalGrid shows **the place**: an ICU wing drawn like an architect's sectional model, with real rooms, beds and machines. Dependencies are the cables and pipes in its ceiling.

Every visual decision comes from the hospital's own world:

- **Theatre scrubs:** the base colour is a deep surgical teal. Scrubs are green-blue because that hue rests eyes that are staring at red, which is why our red alarms carry so strongly against it.
- **Bedside monitors:** big, legible numerals; waveform traces; alarm colours and flash rates taken from the medical alarm standard (IEC 60601-1-8, see section 4).
- **Architectural drawings:** room names, plan and section views, a quiet measuring grid, and labelled services.
- **Building services:** each service has its own lane and colour, the way engineers colour-code pipes and cable trays.

**Where the boldness goes:** one place only, the scroll-driven cascade on the homepage (section 7). Everything else stays quiet, typographic and disciplined.

## 3. References (from lapa.ninja)

These were studied for specific patterns. Copy the pattern, never the look.

| Site (lapa.ninja entry) | What to take |
|---|---|
| **Taara**: taaraconnect.com (Hardware / Technology) | Its hero draws light beams between real buildings in a photo. That is our dependency conduits over the building: draw relationships *on the place*, not on an abstract canvas. |
| **Atlas Motion Systems**: atlasmotion.com (Hardware) | Its preloader is a fine blueprint grid of hairlines that the logo locks into. Use the same engineering-drawing restraint for our load state and section grid. |
| **World Labs**: worldlabs.ai (AI / 3D Websites) | An AI company that leads with a navigable 3D world instead of claims. That is our case for the building model as the hero. |
| **Glyphic Biotechnologies**: glyphic.bio (Biotechnology) | A clinical, near-silent loading moment with a real percentage counter. Our version counts real progress (models and telemetry loaded), never a fake timer. |
| **United Carriers**: unitedcarriers.com (3D Websites) | Heavy display type sitting over a 3D scene, with operations-company seriousness. Shows how large type and a live scene can share the first screen. |
| **Sunrise Robotics**: sunriserobotics.co (Hardware) | Industrial photography-like realism with a single accent. A reminder to keep 3D materials matte and believable, not neon. |

## 4. Colour

### 4.1 Core palette (dark, the default)

| Token | Hex | Role |
|---|---|---|
| `--ward` | `#0E1918` | Page background: scrub teal pushed nearly to black. Never a neutral `#111`. |
| `--panel` | `#162523` | Panels, the side rail, drawers |
| `--rule` | `#263A37` | Hairlines, grid, borders |
| `--ink` | `#E4ECE9` | Primary text |
| `--ink-soft` | `#9DB1AC` | Secondary text, room names |
| `--ok` | `#5FA89B` | Brand colour and the healthy state; the trace colour of a calm monitor |

### 4.2 Status colours: alarm semantics, used for nothing else

Hues and flash rates follow IEC 60601-1-8, the standard for alarms on medical electrical equipment.

| Token | Hex | Meaning | Motion |
|---|---|---|---|
| `--alarm` | `#EF6A5F` | High priority: a rule-validated alert | Flashes at about 2 Hz |
| `--watch` | `#E9B949` | Medium priority: the AI suspects it, the rules don't confirm yet | Flashes at about 0.6 Hz |
| `--ok` | `#5FA89B` | Healthy | Steady |

### 4.3 Service colours: building services, never status hues

| Relation | Token | Hex | Why |
|---|---|---|---|
| `POWERS` | `--power` | `#7C9CFF` | Cobalt; kept clear of amber/red so power never reads as an alarm |
| `SUPPORTS_CONNECTIVITY` | `--network` | `#B39DF0` | Violet, data cabling |
| `ENVIRONMENT_AFFECTS` | `--environment` | `#63C5D8` | Cool cyan for conditioned air (replaces the old ochre, which clashed with `--watch`) |
| `SUPPLIES_OXYGEN` | `--oxygen` | `#CFE8D6` | White-green, after medical oxygen cylinder colours |
| `SUPPLIES_MEDICAL_AIR` | `--air` | `#9AA6AA` | Neutral grey-white, after medical air colours |

### 4.4 Light theme

The light theme is the same system in daylight: `--ward #EEF2EF`, `--panel #F8FAF8`, `--rule #DDE4E1`, `--ink #1D2B2A`, `--ink-soft #4D5E5B`, `--ok #2F7D6B`, `--alarm #C2413A`, `--watch #B8861F`. The service colours are darker so they stay at 3:1 contrast on white: `--power #3D5BD9`, `--network #7A5FC8`, `--environment #1E8FA6`, `--oxygen #6E8F7A`, `--air #6B777B`.

### 4.5 Rules

- All tokens live in `dashboard/src/styles.css` (`:root` and `:root[data-theme="light"]`). The 3D scene reads them at build time through `cssVar()`.

- Status colours appear **only** on things that are in that state. No red buttons, no amber badges as decoration.
- No gradients as decoration. The only gradients are functional: the scrim that keeps the hero copy readable over the scene, and the pulse inside an active conduit.
- All text meets WCAG AA. Status is never shown by colour alone: alarms also carry a label and an icon.

## 5. Typography

There is **one family: Atkinson Hyperlegible Next** (Google Fonts, variable 200–800).

It was designed by the Braille Institute so low-vision readers can tell confusable characters apart (`0/O`, `1/l/I`, `5/S`). An ICU screen is read tired, fast and from across a room, so legibility *is* the personality. That makes it the right choice here, not a default.

| Style | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|
| Display | `clamp(48px, 7vw, 104px)` / 0.95 | 800 | -0.03em | One per page: the homepage statement |
| H1 | 40 / 44 | 750 | -0.02em | View titles |
| H2 | 28 / 34 | 700 | -0.01em | Section heads |
| H3 | 20 / 26 | 700 | 0 | Panel heads |
| Body | 17 / 27 | 400 | 0 | Paragraphs, kept to 64 characters or fewer per line |
| Small | 14 / 20 | 500 | 0 | Captions, help text |
| Readout | `clamp(28px, 3vw, 44px)` / 1 | 300 | -0.02em | Live numbers in a monitor style: thin, big, `font-variant-numeric: tabular-nums` |
| Tag | 12 / 16 | 700 | +0.02em | Equipment tags (`UPS-02`): sentence case, tabular numerals |

- **The type is the graphic.** Set the homepage statement big enough to be the composition, with the building model sitting behind and below it.
- **Readouts** use the light weight at a large size, like a bedside monitor's numbers. They are the only place thin weights appear.
- No all-caps labels, no eyebrow text above headings, no italic or colour-accented single word inside a headline.

## 6. Layout

- 12-column grid, maximum width 1440 px, 24 px gutters, and 16 px side margins on phones.
- Text is **left aligned** everywhere; centred text is used only for the load counter.
- The hairline grid (`--rule`, 1 px) is allowed to show *only* behind the building and in the load state, as the architect's drawing sheet. It is information about scale (1 cell = 1 m), not decoration.
- Hierarchy comes from **space and type**, not boxes. Use as few cards as possible. Each radius has one job: 2 px on tags, 8 px on panels, full round on the state dot. Shadows only on things that float over the 3D scene.

### Homepage

```
┌───────────────────────────────────────────────────────────────┐
│ VitalGrid                               Live twin   Results   │  thin nav, sits on the scene
│                                                               │
│  One failing machine                                          │  Display, left, over the scene
│  can take three others                                        │
│  down with it.                                                │
│                       ┌───────────────────────────────┐       │
│                       │   3D ICU wing, camera on       │       │  pinned canvas (sticky)
│                       │   Bay 02's UPS cabinet         │       │
│                       └───────────────────────────────┘       │
├───────────────────────────────────────────────────────────────┤
│ SCROLLYTELLING (pinned scene, text steps on the left)         │
│  1 The UPS voltage sags      camera pulls back, cabinet amber │
│  2 Perception flags it       halo appears, readout shows 182 V│
│  3 Reasoning predicts        conduits to vent/monitor/pump lit│
│  4 Rules check it            R1–R4 tick one by one            │
│  5 The alert is explained    sentence writes itself           │
│  [ Cause a fault yourself ]  ← opens #/twin with the same fault│
├───────────────────────────────────────────────────────────────┤
│ Why alarms alone fail     threshold alarm storm  vs  one       │
│                           VitalGrid alert; grid-absorbed diagram│
│ Results                   small multiples: F1 and false spread │
│                           × 3 test groups, VitalGrid emphasised│
│ How it's built            7 stations on one line, with the tech│
└───────────────────────────────────────────────────────────────┘
```

### Dashboard (`#/twin` and `#/3d`)

```
┌──────────────────────────────────────────────┬────────────────┐
│ VitalGrid  ● Live   Floor plan  Building  Results  ☾ │ Alerts │
├──────────────────────────────────────────────┤ (validated,    │
│                                              │  newest first) │
│          the twin fills this area            │ PUMP-01  100%  │
│      (2D plan or 3D building, same data)     │ sentence…      │
│                                              │ path · rules   │
├──────────────────────────────────────────────┴────────────────┤
│ Cause a fault  [fault ▾][start at ▾][severity ──●─] [Inject]  │
│ Selected: UPS-02   228.4 V   9.6 A   battery 99 %  ~~~waveform │
└───────────────────────────────────────────────────────────────┘
```

The selected-equipment strip reads like a bedside monitor: big thin numerals, unit after, and a scrolling trace in the service colour.

## 7. The signature moment: scroll is time

The homepage hero is the **real building model** from `Twin3D.jsx`, reused rather than rebuilt, playing a scripted UPS-02 cascade. Scrolling moves time forward:

1. **Open close.** The camera starts at eye level beside Bay 02's UPS cabinet. The readout next to it shows 230 V.
2. **The sag.** As you scroll, the voltage counts down to 182 V, the cabinet's halo goes amber, and the camera lifts through the cut-away wall line.
3. **The spread.** The camera rises to show the whole bay. Conduits from the UPS light in sequence, a pulse travels along each one, and the ventilator, monitor and pump turn red.
4. **The check.** Labels R1–R4 tick on beside the path, one per scroll step.
5. **The sentence.** The explanation writes itself under the bay. The camera settles on the full wing, and the "Cause a fault yourself" button appears.

Implementation:
- **Scroll and timing:** Lenis provides the smooth scroll; GSAP ScrollTrigger pins the canvas and scrubs one master timeline that drives camera position, a `t` value fed to the scene's states, and the text steps.
- **Data:** the cascade is canned data shaped like `/results/latest`, so the hero works even when Render is asleep. Meanwhile the page wakes the server in the background.
- **Reduced motion:** with `prefers-reduced-motion`, the timeline is replaced by five static stills, one per step, and nothing flashes.

## 8. Motion rules

- **Libraries:** GSAP (core, ScrollTrigger, SplitText; all free) for choreography. Lenis for the homepage scroll only; the dashboard uses native scroll so panels stay precise.
- **Allowed:**
  - the hero timeline
  - the alarm flashes in section 4
  - pulses moving along conduits
  - camera fly-to when equipment is selected (0.8 s, `power3.inOut`)
  - a new alert sliding into the list once
  - readouts tweening to their new value
- **Not allowed:**
  - fade-and-slide-up on every section
  - hover lift on every card
  - parallax on text
  - cursor followers
  - marquee logos
  - counting up the results table
- **Durations:** UI 160–240 ms, scene 600–900 ms, with `power2.out` for UI and `power3.inOut` for the camera.
- Any motion that is not triggered by the user stops while the tab is hidden, and respects reduced motion.

## 9. 3D rules (three.js)

- **Materials:** matte and believable, like hospital equipment: off-white enclosures, dark trim, real screens. No glass "holograms", no bloom fog, no neon wireframes.
- **Walls:** cut at 1.3 m, the architect's sectional-model convention, so every room can be seen into.
- **Conduits:** one lane per service along the corridor ceiling, in the service colours. Active paths turn `--alarm` and carry pulses.
- **Area labels:** sentence case (fix the current uppercase ones), placed on each room's back wall.
- **Camera:** a fixed default framing, with orbit limits so it never goes under the floor. Add a "Reset view" control.
- **Performance budget:** 60 fps on an integrated-GPU laptop; under 300 draw calls (merge static walls and furniture); pixel ratio capped at 2; shadows from one light only.
- **Optional post-processing** (pmndrs/postprocessing): soft ambient occlusion only, which makes the model read as physical. Turn it off on phones.

## 10. Libraries and component sources

All were checked on GitHub (stars and last push as of October 2026).

| Library | Repo | Use it for |
|---|---|---|
| GSAP | greensock/GSAP (★29.7k) | Hero timeline, ScrollTrigger pinning, SplitText for the explanation write-on, camera tweens |
| Lenis | darkroomengineering/lenis (★16.9k, MIT) | Smooth scroll on the homepage, driven by GSAP's ticker |
| three.js | already installed (0.186) | The building model. Stay on vanilla three and reuse `Twin3D.jsx`. Don't add react-three-fiber just for the hero; one 3D approach in the codebase. |
| postprocessing | pmndrs/postprocessing (★2.9k, Zlib) | Optional ambient occlusion (section 9) |
| Radix Primitives | radix-ui/primitives (★19.4k, MIT) | Accessible Select, Slider, Tooltip and Dialog for the fault form and equipment details. Style them with our tokens. |
| uPlot | leeoniya/uPlot (★10.6k, MIT) | Monitor-style live waveforms in the selected-equipment strip. It's about 50 KB and fast, and it replaced Recharts, which is no longer installed. |
| Fontsource | fontsource/fontsource (★6.2k, MIT) | Self-host Atkinson Hyperlegible Next (`@fontsource-variable/atkinson-hyperlegible-next`) instead of the Google CSS `@import` |
| Magic UI | magicuidesign/magicui (★22.8k, MIT) | **Pattern only:** its Animated Beam (an SVG path with a travelling gradient) for the pipeline diagram. Port it to GSAP rather than adding `motion` as a second animation library. |
| Motion Primitives | ibelick/motion-primitives (★6.8k, MIT) | **Pattern only:** the Animated Number technique for readouts, rebuilt with a GSAP tween |
| React Bits | DavidHDev/react-bits (★50.2k) | Browse only. Most of its effects are decorative and would push the site toward the generic look. Take nothing that doesn't answer a section of this file. |

Not used, and why:
- **Tailwind or shadcn:** the token system here is small and already lives in CSS variables, and a component kit would bring its default look.
- **Framer Motion:** GSAP covers it; using two animation engines doubles the bundle and the mental model.

## 11. Words

- Plain verbs, sentence case, active voice. Name things the way clinicians and engineers do: "UPS", "ventilator", "Bay 02", not "node 14".
- Buttons say what happens, and the result repeats the verb:
  - "Inject fault" produces "Fault injected at UPS-02."
  - "Clear faults" produces "All faults cleared."
- No arrows appended to links. No middle-dot strings (the 3D hint and corridor label need rewording). No "AI-powered", "revolutionary" or "seamless".
- Errors say what happened and what to do: "The server is waking up. This takes about a minute on the free plan."

## 12. Quality floor

- Responsive down to 360 px. On phones, the 3D view opens in a full-screen sheet, and the hero falls back to the stills when there is no WebGL or the device is low-power.
- Visible keyboard focus (2 px `--ink` outline, offset 2 px). All controls are reachable without a mouse, and equipment can be selected from a list.
- Lighthouse targets: performance ≥ 85 on the homepage, accessibility ≥ 95.
- Bundle budget: the homepage loads less than 250 KB of JS before the scene. three.js and the scene load lazily as the hero comes into view.

## 13. Status

All seven fixes from the first review are built:

1. Atkinson Hyperlegible Next is self-hosted through Fontsource and imported in `main.jsx`; the type scale is applied.
2. The service colours from 4.3 are live, and oxygen and medical air now have their own colours.
3. The 3D area labels are sentence case, and the hint and corridor labels no longer use middle dots.
4. Alarms flash at about 2 Hz and watch states at about 0.6 Hz. With reduced motion, both are steady.
5. The homepage hero is the scroll-driven cascade from section 7 (`Home.jsx`). It uses GSAP ScrollTrigger and Lenis, falls back to the flat diagram without WebGL, and jumps between still shots with reduced motion.
6. Selecting equipment in the 3D view flies the camera to it, and "Reset view" returns to the whole wing.
7. The fault form uses Radix Select and Slider, and the selected-equipment strip shows monitor-style readouts drawn with uPlot.

Bundle sizes (gzipped) after the change:
- **Homepage:** about 127 KB, which is under the 250 KB budget.
- **Dashboard:** about 121 KB, loaded only when a dashboard view opens.
- **three.js scene:** about 147 KB, loaded lazily.
