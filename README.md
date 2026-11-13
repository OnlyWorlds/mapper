# OnlyWorlds mapper

See the maps of an [OnlyWorlds](https://www.onlyworlds.com) world in a browser: its pictured maps with their Pins and Zones, its plans, and its layout maps, where the elements a layout places are joined by the world's own links.

The mapper only reads. It never changes a world.

## Open a world

- **A public world, without an account.** Put its id in the address: `?world=<world id>`. Moppetopia (a small demo world) and Sikelia (a large one) are one press away on the first page.
- **A world of your own.** Paste a read key for it (it starts with `ow_r_`; make one on the world's page on onlyworlds.com). The key is held in the page while it is open and never stored: a reload asks for it again. A write key works too, but a read key is the safer one to paste. Keys of ten digits are not taken.
- **One element's maps.** `?world=<world id>&type=<type>&element=<element id>` opens every map the element has a Pin on, the first one with the element centred, selected and ringed. On a phone the element's card opens as one line (Details opens it whole) and its other maps fold behind one button, so the map keeps the screen. The first is a pictured map if there is one, then a plan, then a layout. Without `type` it still works, by reading the element's Pins first, and says so.

An id that is not an id is said at once. A world that is not public, or not there, answers the same to a visitor, so the page says: "No public world has this id. It may be mistyped, or private: paste a key to open it."

## What it shows

- **A world's maps**, by name, each worded as what it is: *a picture*, *a plan* (no picture), *a layout*, or *a layout · 3D* (a layout with a depth). With how many Pins each holds, when the world's Pins fit one read of 1,000; above that the counts are left out, and the page says why.
- **A map**, flat, filling the window: its picture, its Zones (areas closed, lines open), its Pins coloured by the element's type, and the names of the most linked elements where they fit. Pan by dragging (one finger on a phone), zoom with the wheel or a pinch, or with the + and − buttons; Fit puts the whole map back.
- **Links.** A layout map always draws the world's links between the elements it places. A pictured map keeps them off until you press Show links. A link held on both ends is one line; the card lists each link.
- **The card.** Press a Pin, a Zone, a name or a line to see what it is: the element's name and type, where it stands, its links on this map, and the OnlyWorlds mark, which opens the element in other OnlyWorlds tools. On a phone, a press over several Pins lists them all.
- **The List**, one row per element the map places, by name, with its type and position: the map for a keyboard or a screen reader, one press away.
- **A layout's ground.** A layout drawn over another map shows that map's picture and Zones under its Pins, placed where the layout's own settings say.
- **Layouts with a depth** are drawn flat in this version, with a line saying the 3D view comes later.

The page says what it reads while it reads (Pins, then Markers, then Zones, then the elements), draws what has arrived, and says when a read fails, with Try again. OnlyWorlds lets a visitor read 60 times a minute; when that is reached the page waits and says for how long. What the map reading leaves aside (a Marker whose Zone is not served, a Zone with no Marker) is said in one line once every read has landed.

## The address

The address keeps the view: `&map=<id>` when you open a map (Back returns to the list), and `&at=<x>,<y>,<span>` after you move the map yourself, so a shared link opens the same place; on an element's maps that write names the map too, so the link opens the same one (the span is the map units across the shorter side of the window, so a phone and a desk see the same area). Add `&measure=1` for a readout of the picture's first draw and the frame times.

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
             the pointer's order (hit.ts), the camera, labels, the address and its writer
src/net/     reads: one at a time, each with its own time limit over the whole answer, a 429
             waited out, and stopped when their page is left
src/view/    the canvas renderer and the picture's downscaled copies
src/ui/      the map view, the one pointer mode, small DOM helpers
src/app.ts   the pages: the start, a world's maps, an element's maps, a map
```

### Walks

The walks drive the built page in Chromium and Firefox, at a desk and on a 390 px touch phone (the element view at 360 by 640 too), and in WebKit, with [Playwright](https://playwright.dev). `npm install` brings Playwright but not its browsers: install those once first.

```sh
npx playwright install chromium firefox webkit
npm run build
npm run walk:record   # reads two public worlds keyless and keeps their answers in .scratch/fixtures/
npm run walk:played   # the page against those answers only, nothing reaching the real server
npm run walk:webkit   # the same answers in WebKit: the picture, and a held arrow key
npm run walk:look     # the page against the real worlds, screenshots in .scratch/look/
```

The played walk also plays what the public worlds do not hold: a read whose body stalls, a Pin and a Marker far past their map, a map with no written size, a name of 3,000 characters, a stranger's markup as names.

The recorded answers stay out of the repository: they are the worlds' own rows and pictures, and are read again whenever wanted.

## License

MIT
