# Street Fighter 2026

A browser-based 2-D fighting game inspired by Street Fighter, built with vanilla HTML5 Canvas and JavaScript — no dependencies, no build step.

**Play it live:** hosted on GitHub Pages at `https://<owner>.github.io/Street-Fighter-2026/`

---

## Features

- Two distinct fighters — **RYU** (white gi, red headband) vs **KEN** (red gi, blonde hair)
- Best-of-3 rounds with a 99-second timer
- Smooth canvas-rendered animations (idle, walk, jump, crouch, punch, kick, win, KO)
- Melee attacks: Light Punch, Heavy Punch, Light Kick, Heavy Kick
- Special move: **Hadouken** fireball for both fighters
- Standing & crouching block (deflects 80 % of incoming damage)
- Hit effects, health bars, win-dot indicators
- Procedural sound effects via Web Audio API
- **1-Player mode** (vs CPU) or **2-Player mode** on the same keyboard
- Cyberpunk night-city arena background (fully procedural — no external assets)

---

## Controls

| Action          | Player 1 | Player 2 (2P mode)    |
|-----------------|----------|-----------------------|
| Move left/right | `A` / `D` | `←` / `→`           |
| Jump            | `W`      | `↑`                   |
| Crouch          | `S`      | `↓`                   |
| Light Punch     | `J`      | Numpad `1`            |
| Heavy Punch     | `K`      | Numpad `2`            |
| Light Kick      | `U`      | Numpad `3`            |
| Heavy Kick      | `I`      | Numpad `0`            |
| Hadouken        | `L`      | Numpad `.`            |
| **Block**       | Hold back (away from opponent) |     |

> On the menu screen press **T** to toggle between 1-Player and 2-Player mode, then **Enter** to start.

---

## Run locally

Just open `index.html` in any modern browser — no server required:

```bash
# macOS
open index.html

# Linux
xdg-open index.html

# or use any simple HTTP server:
python3 -m http.server 8080
```

---

## Deploy to GitHub Pages

Push to the `main` branch. The included GitHub Actions workflow (`.github/workflows/deploy.yml`) will automatically deploy the `index.html` and static assets to GitHub Pages.
