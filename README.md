# OnlyWorlds mapper

See the maps of an [OnlyWorlds](https://www.onlyworlds.com) world in a browser: its pictured maps with their Pins and Zones, its plans, and its layout maps, where the elements a layout places are joined by the world's own links.

The mapper only reads. It never changes a world.

## Open a world

The first page is a home of worlds and their maps: each world is a row with its name, what it is to you, and its first maps as cards (the top maps first, at most six, each with its kind), then one card for all of the world's maps. A pictured map's card shows a small copy of its picture (one width, 480 pixels, made by the media host at media.onlyworlds.com; a picture on any other host is not shown on the home); a plan or a layout shows its kind's mark in the same place, as does a picture whose small copy cannot be had. A row with more cards than fit scrolls sideways inside itself. One press on a card opens that map.

- **A public world, without an account.** The home shows three public demo worlds (Moppetopia, Sikelia and Blood Meridian) from a list built into the page, so it reads nothing from the OnlyWorlds API until you press a card (only the cards' small pictures, from the media host). Any other public world opens by its id in the address: `?world=<world id>`, or in the id field on the home.
- **Sign in with OnlyWorlds**, for the worlds you own and the ones you joined. It is offered only on maps.onlyworlds.com, the address OnlyWorlds sends you back to. Signed in, the home shows your worlds first (yours, then the ones you joined, each saying what it is to you), then the demo worlds below a line; a world's maps are read when its row comes into view, one world at a time. A world on your list is always read as you, with your sign-in; any other world is read as the public reads it. The mapper only reads and never makes keys. The sign-in is an account token held in the page's memory and never stored, so a reload asks you to sign in again. It is removed from your account when you sign out, and the page tries to remove it when you leave; a sign-in left behind (a closed browser, a killed tab) ends by itself six hours after you signed in, and until then it is listed under Account settings on onlyworlds.com, where you can remove it. OnlyWorlds remembers that you agreed, so the next Sign in goes straight through: on a shared computer, sign out of onlyworlds.com too.
- **A world of your own.** Paste a read key for it (it starts with `ow_r_`; make one on the world's page on onlyworlds.com). The key is held in the page while it is open and never stored: a reload asks for it again. A write key works too, but a read key is the safer one to paste. Keys of ten digits are not taken.
- **One element's maps.** `?world=<world id>&type=<type>&element=<element id>` opens every map the element has a Pin on, the first one with the element centred, selected and ringed. On a phone the element's card opens as one line (Details opens it whole) and its other maps fold behind one button, so the map keeps the screen. The first is a pictured map if there is one, then a plan, then a layout. Without `type` it still works, by reading the element's Pins first, and says so.

An id that is not an id is said at once. A world that is not public, or not there, answers the same to a visitor, so the page says: "No public world has this id. It may be mistyped, or private: paste a key to open it." On maps.onlyworlds.com it also offers Sign in with OnlyWorlds, and comes back to that world. An element no Pin places keeps its line, with the world's maps listed under it, one press into any.

## What it shows

- **A world's maps**, by name, each worded as what it is: *a picture*, *a plan* (no picture), *a layout*, or *a layout · 3D* (a layout with a depth). With how many Pins each holds, when the world's Pins fit one read of 1,000; above that the counts are left out, and the page says why.
- **A map**, flat, filling the window: its picture, its Zones (areas closed, lines open), its Pins coloured by the element's type, and the names of the most linked elements where they fit. Pan by dragging (one finger on a phone), zoom with the wheel or a pinch, or with the + and − buttons; Fit puts the whole map back.
- **Links.** A layout map always draws the world's links between the elements it places. A pictured map keeps them off until you press Show links. A link held on both ends is one line; the card lists each link.
- **The card.** Press a Pin, a Zone, a name or a line to see what it is: the element's name and type, where it stands, its links on this map, and the OnlyWorlds mark, which opens the element in other OnlyWorlds tools. On a phone, a press over several Pins lists them all.
- **The List**, one row per element the map places, by name, with its type and position: the map for a keyboard or a screen reader, one press away.
- **A layout's ground.** A layout drawn over another map shows that map's picture and Zones under its Pins, placed where the layout's own settings say.
- **Layouts with a depth open in 3D.** Each Pin stands at its height, with a thin stem down to the ground's height; the links run between the Pins where they stand; the ground's picture lies at its own height and never hides what is under it. Drag to turn (one finger on a phone), the wheel or two fingers to zoom, right- or middle-drag to move; the arrow keys turn, + and − zoom, Fit and `0` show the whole map again. The selection, the card and the List are the same as flat, and **Flat** draws the same map flat. The 3D view's code is fetched only when a 3D map opens; if it cannot be fetched, or the browser cannot start WebGL, the map is drawn flat with a line saying why.
- **Icons, in 3D.** In the 3D view each Pin is drawn as its element type's icon: it grows as it comes nearer and, once it is drawn 16 pixels wide, turns from a dot into its type's icon on a dark disc ringed in its colour. A selected Pin and the Pins its links reach are drawn larger and glow; a Pin of a type with no icon stays a dot, and a browser that cannot draw the icons draws every Pin as a dot. A press picks a Pin where it is drawn, however large.

- **The world in 3D, by its links.** A world's page offers *Lay out by links, in 3D*: the elements you can see, joined by their links, laid out by the OnlyWorlds method `by-links-3d` and drawn in the 3D view as a layout map would be (Flat, the card and the List as on any map). Every group of elements linked to each other apart from the main one stands on a ring round it. An element linked to no other and not pinned on the plate is not placed by the method: the mapper stands it on the floor, beside the group where most elements of its kind stand (a kind no group holds gathers just below the picture), drawn and pressed like any other, and one line under the picture says how many stand on the floor. The floor is made from the method's answer alone, so the same picture draws the same floor. It is drawn here and not saved: the mapper writes nothing, and Atlas is where a layout is saved. When the world has a map that pins three or more of its elements, the map that pins the most is a flat plate, each of its pinned elements at its Pin, as long as its written width and height, where it has them, are above 0 (a map with no written size is measured from its points); otherwise there is no plate. The press reads no Markers, so a map with no written size is measured from its Pins alone, where the method would measure it from its Markers too (a known gap, 2026-11-19: no demo world has such a plate). The reads and the layout never hold the page: the reads go one at a time, the layout runs in a worker of its own, and a line counts the elements and the seconds, with **Cancel**. The picture is kept, per world and per reader, so the next press keeps it still and places only what is new: a line says "Laid out from nothing." or "Kept the picture you last saw here; N placed new.", and **Lay out again from nothing** draws a fresh one. A public world's picture is kept on this device (in the browser's IndexedDB, at most four pictures, the least recently written dropped first). A picture laid out with a sign-in or a pasted key is kept only in the page's memory: it is never written to the device, signing out drops it, and it goes with the page. A press uses this tab's reading of the world (the line says when it was first read); a reload reads again. When OnlyWorlds says a world holds more than 10,000 elements you can see, the press is not offered; when it does not say, the press reads up to 10,000 and then says so. A world whose Pins pass 10,000 is laid out with no plate, said in one line. The method is not final, so a later version may draw a world differently: the kept picture keeps it still meanwhile, until the method itself changes; a picture kept by an earlier version of the method is dropped and the world laid out from nothing, said once in its own line.

The page says what it reads while it reads (Pins, then Markers, then Zones, then the elements), draws what has arrived, and says when a read fails, with Try again. OnlyWorlds lets a visitor read 60 times a minute; when that is reached the page waits and says for how long. What the map reading leaves aside (a Marker whose Zone is not served, a Zone with no Marker) is said in one line once every read has landed.

## The address

The home is `/`. The address keeps the view: `&map=<id>` when you open a map (Back returns to the list), and `&at=<x>,<y>,<span>` after you move the map yourself, so a shared link opens the same place; on an element's maps that write names the map too, so the link opens the same one (the span is the map units across the shorter side of the window, so a phone and a desk see the same area). The world in 3D is `&layout=by-links-3d` (Back returns to the world's maps; a reload lays it out again, with the kept picture), never with a camera; Flat adds `&view=flat` beside it, and a sign-in started there comes back to the world's maps. On a layout with a depth, Flat adds `&view=flat`; the 3D camera is not kept in the address, so a link to a 3D map opens it whole. Add `&measure=1` for a readout of the picture's first draw and the frame times.

## Run it

```sh
npm install
npm run dev        # a local server on port 5173
npm test           # the unit tests
npm run build      # dist/, served as static files
```

It uses [`@onlyworlds/sdk`](https://www.npmjs.com/package/@onlyworlds/sdk) for every reading of the world: `mapSpace` for Pins and Zone outlines, `layoutOf` for layout maps and their ground, `worldGraph` and `degreeOf` for links and the names drawn, and the Waymark for the mark on the card. It draws on a 2D canvas with no other library.

### How it is built

Everything drawn comes from one scene list, made by a pure builder from the opened map's part of the world store and rebuilt only when a read lands. A second pass over the list draws what depends on the view: the names placed when the map rests, the hover, the selection and the element's ring. The pointer asks the list, never the page or the pixels.

```
src/core/    the pure part: kinds of map, the store and the slice, the builder (scene.ts),
             the pointer's order (hit.ts, and hit3d.ts for the 3D view's projected list),
             the camera, labels, the address and its writer,
             the home's order of a world's maps and its words (home.ts), the demo worlds
             built into the page (demos.ts, written by walk/demos.mjs), the 3D layout's answer
             as a made-up Map and Pins and its words (links3d.ts), the kept picture's key and
             form (hold.ts), and what its worker runs (layout3d.ts, links3d.worker.ts)
src/net/     reads: one at a time (a page that reads several worlds shares one queue), each with
             its own time limit over the whole answer, a 429 waited out, stopped when their
             page is left; on the account token, the first 401 is the sign-in ending, said once
src/auth/    Sign in with OnlyWorlds (the round trip's record in localStorage with a stamp, swept
             after an hour; the callback taken at load, before any other request) and the
             token's revoke (keepalive, once more without on refusal); net/holds.ts keeps the 3D
             layout's pictures in IndexedDB
src/view/    the canvas renderer, the picture's downscaled copies, and the 3D surface (three3d.ts,
             three.js, in a chunk of its own fetched only when a 3D map opens)
src/ui/      the map view, the home's rows and cards, the one pointer mode, small DOM helpers,
             the page's side of the 3D layout's worker (layout-worker.ts)
src/app.ts   the pages: the home, a world's maps, an element's maps, a map; the sign-in's life
             (held by the reader and the world's id, ended once, revoked when the page is left)
```

### The host

maps.onlyworlds.com serves `dist` as static assets (`wrangler.jsonc`) with no single-page fallback: an unknown path is the 404 page. Sign in with OnlyWorlds returns to `/signin/callback`, which the host serves from a real file, `dist/signin/callback.html` (the same page as `/`, built from `signin/callback.html`), by its `auto-trailing-slash` handling. `public/_headers` keeps that path out of every cache and sends no Referer from it, and the page replaces its address with `/` (or where you were) before anything else.

### Walks

The walks drive the built page in Chromium and Firefox, at a desk and on a 390 px touch phone (the element view at 360 by 640 too, a phone turned to 844 by 390, and desk windows of 844 and 900), and in WebKit, with [Playwright](https://playwright.dev). `npm install` brings Playwright but not its browsers: install those once first.

```sh
npx playwright install chromium firefox webkit
npm run build
npm run walk:record   # reads two public worlds keyless and keeps their answers in .scratch/fixtures/
npm run walk:played   # the page against those answers only, nothing reaching the real server,
                      # Sign in with OnlyWorlds and the home included (walk/signin.mjs)
npm run walk:webkit   # the same answers in WebKit: the picture, and a held arrow key
npm run walk:look     # the page against the real worlds, screenshots in .scratch/look/
```

The played walk also plays what the public worlds do not hold: a read whose body stalls, a Pin and a Marker far past their map, a map with no written size, a name of 3,000 characters, a stranger's markup as names. Its sign-in part serves the build as maps.onlyworlds.com under the host's own rules (`walk/host.mjs`, which the walks' local server uses too) and plays OnlyWorlds' sign-in: the consent page, the exchange, the account's worlds, reads on the token, the revoke, a sign-in that ends, a member of forty worlds, Back, a reload, and leaving the page.

The played walk's 3D sections read the WebGL canvas through screenshots (`walk/png.mjs`): the ground drawn and the right way up (against the flat view and its mirror), a buried Pin drawn and pressed, a turn that selects nothing, Flat and back, the 3D code blocked and WebGL refused. `node walk/chunks.mjs` builds once more and fails if any of three.js reaches the page's first chunk, or the 3D layout's code (found by `held-box`, a word only it holds) is anywhere but its worker's own file.

The played walk's section `links3d` (`walk/links3d.mjs`, also run alone: `node walk/links3d.mjs [chromium|firefox]`) plays worlds of its own: the press, the running line and Cancel (while it reads and while the worker lays out 2,000 richly linked elements), the elements it does not place (on the floor, pressed and focused), a press and its focus on a placed Pin, the kept picture (a second press, an element added between two reloads, a planted bad picture, a picture an earlier version of the method kept), Lay out again from nothing, Flat, Back, the ceilings, an empty world, a world whose elements link to nothing (all on the floor), a failed read and its Try again, a Map whose width is below 0 (no plate), a layout that throws (the worker's file played as a failing one), and that every request is a GET.

The played walk's section `look3d` (`walk/look3d.mjs`, also run alone: `node walk/look3d.mjs [chromium|firefox]`) plays a layout of its own and reads the icons' drawn widths from the picture's pixels, at device ratio 1 and 2: at Fit, a Pin just below and one just above the 16 pixel threshold (a dot, then its icon), along a zoom until a Pin turns into its icon, a selected Pin and the Pin its link reaches at their lit sizes, the rest dimmed, and the dots where a browser cannot draw the icons. It presses near a large icon's rim, where a selected Pin overlaps a nearer dimmed one (the selected must win), and on the lowest Pin at Fit (on a phone also turned on its side). `BENCH_DOTS=<a build that draws dots> node walk/look3d.mjs [chromium|firefox] --bench` times a frame on a world of 5,000 Pins with the icons against the dots of a build from before them, one page at a time, each frame waited for, and prints the renderer that drew it; Chromium draws on the machine's GPU there (`LOOK_GPU=high` asks for a laptop's faster one), as headless Chromium otherwise draws WebGL in software.

`node walk/demos.mjs` writes the demo worlds' list again from keyless reads, when their maps change.

`node walk/live-home.mjs [chromium|firefox]` reads the home on maps.onlyworlds.com as a stranger: every demo picture card's small copy loaded and small, no picture read whole, nothing read from the OnlyWorlds API, each row's boxes level (`LIVE_BASE` points it at another address).

The recorded answers stay out of the repository: they are the worlds' own rows and pictures, and are read again whenever wanted.

## License

MIT
