# Meridian

*Build the city. Watch it come alive.*

Meridian is a browser-first 3D city builder written in TypeScript and Three.js. You start with an empty valley and a highway. You lay out streets, zone land, and supply power, water and services. Then you watch the city grow: houses and towers rise, residents look for work, cars fill the streets, and traffic, pollution and budgets push back on your decisions.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check and build a production bundle into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests (Vitest) for the simulation |
| `npm run test:e2e` | End-to-end tests in Chromium (Playwright); run `npx playwright install chromium` once first |
| `npm run assets` | Regenerate the 3D models with Blender (background mode) |
| `npm run bench` | Simulation benchmark: grows a ~25,000-resident city headlessly and reports tick times |
| `npm run bench:save` then `npm run bench:render` | Render benchmark: loads that city in Chromium and measures frame times from several viewpoints |
| `npm run check:geometry` | Scans generated buildings for overlapping (z-fighting) faces |

Requirements: Node 20+, a browser with WebGL 2. Blender 4.2+ is only needed if you rebuild models.

## Playing

Found a city on one of four maps: **Coastal Bay**, **Lakeland Valley**, **Highland Ridge** or **River Valley** (a meandering river east of the start that you bridge to expand). Any seed gives a new layout.

For a challenge, choose **Scenarios** on the main menu. Each one sets a hand-picked map, starting funds, a time limit and a set of objectives: *First Steps* (easy), *Across the River* and *Green Valley* (medium), and *Tourist Coast* and *Mountain Metro* (hard). A chip in the top bar counts down the time left and shows how many objectives you have met, and the Goals panel shows progress on each one. When every objective is met at a month's end you win. If time runs out first you lose and can try again. Either way you can keep building afterwards. The menu marks the scenarios you have won.

1. **Connect to the highway.** Open **Roads** and draw a street that starts on the end of the highway.
2. **Zone.** Under **Zoning**, paint with the brush or use *Fill street* to zone a whole side of a road.
3. **Utilities.** Wind turbines, a water tower (or a shoreline pumping station) and a sewage outfall. They serve every building on the same connected road network.
4. **Grow.** Buildings appear when the demand bars (R · C · I · O, top right) are high and utilities have spare capacity. Hover the bars to see why demand is high or low.
5. **Run buses.** From 1,000 residents, open **Transit**: build a Bus Depot, place stops along streets, then use *Bus Line* to click the stops in order (click the first stop again to close the loop). The Transit panel shows riders, load and costs, and lets you add or remove buses.
   **Open an airport** at 12,000 residents: the Regional Airport (Transit tray) needs a long straight road and plenty of room. Airliners taxi, take off and land on a timetable, flights bring tourists, cargo and business demand, and the jets are loud, so keep homes at a distance. Valuable commercial land near attractions (landmarks, the botanical garden, the airport) grows **hotels**, whose overnight guests add up to 60% to tourism income.
   **Ship goods by sea** from 2,500 residents. Build a Cargo Harbour (Transit tray) on the shore with the back of the lot facing the water; the berth is dredged for you. Container ships sail in from the open sea (or across a lake) along a planned shipping lane, tie up while the gantry cranes work, then head back out. Sea freight lifts industrial demand and brings imported goods to the shops. Ships can't pass under bridges, so keep a channel open. The harbour's inspector shows what its ship is doing.
   **Ship goods by sea** from 2,500 residents. Build a Cargo Harbour (Transit tray) on the shore with the back of the lot facing the water; the berth is dredged for you. Container ships sail in from the open sea (or across a lake) along a planned shipping lane, tie up while the gantry cranes work, then head back out. Sea freight lifts industrial demand and brings imported goods to the shops. Ships can't pass under bridges, so keep a channel open. The harbour's inspector shows what its ship is doing.
   **Dig a metro** from 5,000 residents: place Metro Stations (at least 240 m apart), then click them in order with *Metro Line*. Trains run underground in straight tunnels (you pay per metre once; later lines reuse tunnels for free), riders walk up to 520 m to a station, and commuters pick whichever of car, bus or metro gets them to work fastest.
6. **Set policies and build landmarks.** The Policies tab of **City Info** (I) has city-wide programmes such as recycling, smoke detectors, tax breaks, free transit or a high-rise ban, each with a running cost or trade-off. Paint **Districts** to name neighbourhoods, then enact district policies (smoke detectors, recycling, neighbourhood watch, clean air, adult education, park rangers, high-rise ban) for just that area. A downtown can grow tall while the suburbs stay low, and a district policy only costs what its residents and businesses use. Milestones unlock unique landmarks (City Hall, Museum, Cathedral, Stadium, Observation Tower) under Services → Parks & landmarks; they lift land value and happiness around them and bring tourists and tourism income.
7. **Serve and manage.** Add police, fire, healthcare, schools, garbage collection and parks as the city grows. At 6,000 residents you can found a **University**. Its campus has a clock-tower hall, brick wings around a quad, a domed library and a glass science block. Residents within reach are far more likely to earn degrees, and the graduates lift office demand. Unhappy households drift away gradually, and newcomers avoid homes their neighbours are leaving. Fix what's wrong (the newspaper usually says what) and they come back. Parks range from pocket parks, community gardens and sports courts to a floodlit sports field, a botanical garden with a glass palm house (which also draws tourists) and Central Park. Check the budget and adjust taxes. Use map layers (Tab) to diagnose traffic, land value, pollution or coverage.
   **Shape the land** with the Terrain tool (G): raise hills, dig valleys, level building sites or smooth rough ground, paying per cubic metre of earth moved. Dig below sea level and the hole fills with water. Ground under and beside roads and buildings never moves, so nothing you have built floats or sinks. The same tray plants trees ($25 each; saplings grow to full size in two months) and clears them. Woods near homes filter pollution, damp traffic noise and raise land value. Freshly moved earth shows as bare soil that grasses over within a month.
   Zoom in and street names appear along the roads (switch them off in Settings). Sailboats and motor cruisers wander the bay, lakes and river, airliners fly from the airport, and cloud shadows drift over the land on breezy days. A highway sign welcomes drivers with your city's name and population. Everything is synthesised live: a generative score, traffic hum, surf on the shore, factory drone, birdsong in parks, rain and thunder.
   Click any building, road, bus stop or vehicle to inspect it. A car's panel shows what it is doing (driving to work, shopping, delivering goods, responding to a fire) and where it is heading; buses show their line. Press *Follow* to ride along with the camera, and pan to stop.
   **Natural disasters** are off unless you switch them on in Settings: then a rare tornado may touch down in spring and summer storms, flattening whatever lies in its narrow path and damaging homes nearby. Zoned lots rebuild on their own.
   **Read the paper.** At the end of every month the local paper prints an edition about what happened. Its name grows with the city, from the *Gazette* through the *Courier* and *Herald* to the *Times*. The headline is chosen by news value: a tornado or a new milestone beats a tax rise, which beats a traffic jam on a named street, and quiet months get seasonal features instead. A toast shows the headline. Click it, press N or use the News button at the bottom of the tool rail to read the full edition and the last year of back issues. Stories about a place have a *See on the map* link. And the city celebrates: fireworks burst over downtown at midnight on New Year's Day, on the first night after a new milestone or a scenario win, and sometimes after a night match at the stadium. Each burst lights the streets in its colour, and the bangs reach you a moment after the flash, because sound travels slower than light.
**Change your keys.** Controls (main menu or pause menu) draws your keyboard (pick full size, tenkeyless, 75%, 65% or 60%) with every key coloured as free, in use, or used by more than one action. Click any binding and press a new key to change it; each action can have two keys. If your keyboard lacks a key something uses (a 60% board has no Home or arrow keys), the window lists those actions so you can move them. Your bindings are saved and the tool rail's tooltips follow them.

**More to build.** Roads come in seven types: Lane, Street, Avenue, Boulevard, Parkway (scenic, no zoning), Highway and Expressway (six-lane freeway). Zoning adds High-Density Commercial (hotels, department stores, retail towers; from 4,000 residents) and Light Industry (clean workshops, urban farms and tech parks with a third of the pollution, so they can sit near homes; from 1,500). Services add a Public Library, Police and Fire Headquarters (wide coverage, from 4,000) and a Waste Incinerator that never fills up and burns off old landfill waste. Utilities add a Gas Power Plant, a one-per-city Nuclear Power Plant and a shoreline Water Purification Plant.

**Expand your land.** A new city owns the 3 × 3 parcels (each 512 m square) around its start, plus the highway. Roads, zoning, buildings, terraforming and trees only go on owned land; the rest of the map is dimmed. Open City Info → **Land** to buy a parcel next to land you own: the first costs $250,000 and each one after costs 50% more. Cities saved before land existed own the whole map.

8. **Save.** Press Ctrl+S or the save button at the right of the top bar: it saves straight away, no file needed, and "Saving. . ." shows in the bottom-right corner. The city also autosaves every 3 minutes into the same save, and leaving a city (exiting to the menu or closing the window) asks whether to save first. Press **Play** on the main menu to see all your cities at their latest save. To keep a separate copy or a file, use *Save as / export* in the pause menu (Esc).

The **Goals** tab of City Info also tracks 16 achievements for the long game (bridges, roundabouts, a year of surpluses, a metro, the airport, a 25-floor skyline, 25,000 residents and more). It guides the first steps, and while you are idle a pulsing tip points at the button for the next one (dismiss it, or switch tips off with *Hide tips* or in Settings). Population milestones unlock boulevards, highways, office and high-density zoning, hospitals, coal and solar power, recycling, and bigger parks.

### The interface

- **Top bar**: city name and milestone, treasury and projected monthly cash flow (click for the budget), population, happiness, the load on power, water and sewage (amber above 90%, red when buildings go without), unemployment, the date and weather, pause and speed controls, the R · C · I · O demand bars (hover for the reasons), then save, settings and the menu.
- **Tool rail** (left): Select, Build, Roads, Zoning, Services, Utilities, Transit, Landscape and Demolish, then **Analysis** (map layers) and **City Info**. News and Photo mode sit at the bottom. Tooltips show each shortcut.
- **Construction dock** (bottom): opens with any build tool. It has tabs for each category, contextual modes (road drawing modes, zoning brush or street fill, terrain brush sizes) and a card per item with its price. Locked items show what unlocks them.
- **City Info** (left): one panel with tabs for Overview, Budget, Policies, Districts, Transit, Goals and the notification Log. The inspector for whatever you click opens beneath it, with occupancy or staffing, residents and jobs, happiness, land value, tax revenue or upkeep and funding, problems and service access.
- **Map layers** (right): switch on one analysis layer at a time (traffic, land value, happiness, districts, transit access, pollution, noise, electricity, water and sewage, and each service's coverage) with its legend and an explanation. Tab cycles through them.
- **Notifications** (bottom right): real game events such as fires, shortages, low funds, openings and milestones. Click one to fly there, or dismiss it.
- **Interface scale** (Settings): Automatic enlarges the interface on tall screens (about 133% at 1440p); you can also choose 100–150%.

### Controls

| Action | Input |
| --- | --- |
| Move | WASD / arrows (hold Shift to go slowly) |
| Look around (Free cam: turn in place) | Right-drag · Alt+drag |
| Pan | Middle-drag |
| Camera style | Settings → Camera style: *Classic* (the default: right-drag pans; middle-drag, Alt+drag or holding Q / E orbit; a tap of Q / E switches dock tabs) or *Free cam* (the rows above) |
| Tilt | R / F |
| Continue from the end of the last road | F (road tool) |
| Raised highway (overpass) | Pick Highway, then **Raised** in the road modes |
| Glide to a spot | Double-click the map |
| Reset view (default heading and tilt) | Home |
| Switch build dock tab | Q / E while the dock is open |
| Zoom | Mouse wheel (zooms toward the cursor) |
| Cancel / back | Right-click · Esc |
| Pause / speeds | Space · Shift+1 · Shift+2 · Shift+3 |
| Main tools | 1 Select · 2 Roads · 3 Zoning · 4 Services · 5 Utilities · 6 Transit · 7 Landscape |
| Construction dock | C |
| Same tools by letter | T roads · Z zoning · X services · U utilities · Y transit · G terrain · B demolish |
| Map layers · City information | L · I |
| Snap road angles / free placement | Hold Shift / hold Ctrl while drawing |
| Street grid (Roads → Grid) | Click two corners, move out for depth, click · `[` `]` block size |
| Finish a bus line | Click its first stop again, or Enter |
| Brush size | `[` `]` or Alt+wheel |
| Flip building side | R while placing |
| Cycle map layers | Tab |
| Touch | One finger: tap to select, drag to pan (while inspecting) or draw with tools · two fingers: pan, pinch to zoom, twist to rotate |
| Photo mode (hide the interface; Enter saves a PNG) | P |
| Inspect / follow a vehicle | Click it, then *Follow* in its panel |

## How the simulation works

- **Roads** form a graph of nodes and quadratic-Bezier segments. When roads cross, the planner splits both and creates a junction. It rejects shallow crossings, overlaps and steep grades. Roads that cross water become bridges: the deck clears the water by 6.5 m and ramps down onto land (the ends must be far enough from the shore), spans cost four times as much, the lake bed is left untouched, and the renderer adds parapets, a deck soffit and piers. Other roads can only join a bridge where it meets the ground, and nothing can be zoned along it. Junction geometry (trims, curb corners, crosswalks) comes from the graph. Junctions with avenues or larger roads get traffic signals; street-only junctions are yield-controlled. Streets and avenues can be one-way (the *One-way* toggle draws them in the drawing direction, and the *Direction* mode flips or restores existing roads): routing, traffic assignment and cars respect the direction, all lanes flow the same way, and arrows are painted on the road. The *Roundabout* mode turns an intersection into a one-way ring (counter-clockwise, for right-hand traffic) with a planted island; cars on the ring have priority and entering cars give way.
- **Zoning** is a 4 m grid that can only be painted near roads that allow zoning. Buildings grow on lots that face the road. The spawner packs lots next to their neighbours, checks every lot against roads, other buildings, zone coverage and slope, and then levels the terrain under it.
- **Households** are stored as typed arrays: home, size, workers, education and two job slots. Job matching runs in batches and prefers nearby workplaces on the same connected road network. Office jobs need educated workers.
- **Traffic** runs on two levels. A macro model routes aggregated trips (commutes, shopping, freight, visitors) along shortest-path trees, spread over several ticks, to get peak-hour volumes and congestion. A* routing then uses those congestion-weighted travel times. Visible cars are lane-based agents: they follow the car ahead, stop at red lights, yield at junctions and queue when the next lane is full. They drive slower on congested roads, so bad layouts show up visibly.
- **Public transit**: bus stops attach to road segments (and follow them when roads are split or upgraded); lines loop through their stops and need a depot on the same road network. Once a day, commuters who live and work within a short walk of stops on the same line compare door-to-door bus time (walk, wait from the headway, ride) with driving (distance and current congestion). A share of them switch, which removes their trips from the traffic model and the visible cars. Crowded lines are capped by bus capacity. Fares and per-bus costs appear in the budget, and served stops raise nearby land value. Visible buses drive the loop, dwell at each stop and retire when the fleet is reduced.
- **Weather** follows the seasons: a Markov chain of clear, overcast, rain, thunderstorm and fog spells (rain falls as snow below freezing) with smooth transitions in cloud cover, precipitation, wind and temperature. Rain wets the roads and snow builds up and melts over days. Wet or snowy roads and fog slow traffic, wind turbine and solar output follow the wind and sun, and dry heat raises fire risk. Visually: GPU-animated rain and snow around the camera, overcast lighting, fog, glossy wet asphalt with puddles, snow on roofs, ground and trees, raindrop ripples on water, and lightning with rolling thunder.
- **Policies and landmarks**: policies hook into the systems they affect (garbage generation, fire risk, crime threshold, education speed, transit mode choice, pollution, park value, demand, tax income, building height) and their costs scale with the city. Landmarks act as large leisure attractions, earn tourism that depends on overall happiness, and generate visitor traffic from the highway.
- **Economy**: taxes per household and per worker scale with land value and building level. Road and service upkeep accrue every hour, construction is paid up front, and loans are available.
- **Services** cover a radius that fades toward the edge. A service's effectiveness drops when more residents are in range than its capacity. Fire risk, crime, sickness, garbage and park access all feed happiness, land value and building upgrades.
- **Land value, pollution and noise** live on a 16 m grid and update daily from parks, services, shops, water views, industry and road noise.
- **Simulation level of detail**: systems run at different rates (every hour, every 6 hours, daily, monthly). Traffic assignment is incremental, and vehicles far from the camera update less often.

## Architecture

```
src/
  core/        math, seeded RNG, noise, spatial hash, heap, 2D geometry, encoding
  sim/         the headless simulation (no Three.js): roads, zoning, buildings,
               population, traffic, economy, services, utilities, demand,
               land value, districts, progress, save/load; City + CitySim + CityCommands
  render/      Three.js: renderer & post, sky/day-night, camera, chunked terrain,
               water, roads, buildings (procedural generators + shader), props,
               vehicles, pedestrians, effects, overlays, ghosts
  tools/       player tools (inspect, road, zone, bulldoze, place, district)
  ui/          HTML/CSS interface (HUD, dock, panels, inspector, menus)
  audio/       sound effects (interface samples plus synthesised world sounds), ambience and a generative ambient score (Web Audio)
  platform/    storage abstraction (IndexedDB today, native bridge later)
  game/        Game loop, input routing, demo town
tests/         Vitest unit tests for the simulation
e2e/           Playwright end-to-end and visual tests
tools/blender/ Blender asset pipeline (build_assets.py)
```

- **Rendering vs. simulation**: everything under `src/sim` runs headless in Node; that's what the unit tests exercise. Renderers read the simulation's change logs and rebuild only what changed.
- **Chunks**: the 3 km map is split into 256 m chunks. Each chunk merges its terrain, roads and buildings into one mesh. Buildings use one shared material, and a small state texture drives construction growth, highlights, abandonment, fire and overlays per building.
- **Instancing**: trees (two levels of detail), street lights, signals, parked and moving vehicles, pedestrians, cranes and wind turbines are all instanced.
- **Save format** is versioned JSON (`SAVE_VERSION`, with a migration table) and gzip-compressed in IndexedDB. Terrain and vegetation regenerate from the seed; terraforming is stored as sparse centimetre deltas against the generated heightmap (and its road-surface field), so reloads are exact. Saves can also be exported and imported as files.

## 3D assets (Blender)

`tools/blender/build_assets.py` builds every vehicle, tree, street light, signal, crane and wind turbine procedurally with Blender's `bmesh`, and exports GLBs to `public/assets/models/`. Material names carry meaning for the loader: `Body*` takes the per-car paint colour, `Glass*` reflects, `Headlight`/`Taillight`/`Lightbar`/`Lamp` glow at night. Trees use alpha-tested leaf cards with outward-facing normals. The leaf texture is generated at runtime. If a model fails to load, a procedural fallback stands in.

## Desktop app (Electron)

The `desktop/` folder wraps the web build in Electron without changing the game. It has its own dependencies, so the browser project stays light.

```bash
npm --prefix desktop install   # once (downloads Electron)
npm run desktop                # build the game and run it in a desktop window
npm run desktop:dist           # build an installer into desktop/release/
```

- The game is served from a private `app://` origin (ES modules and model files load the same way as on the web).
- `desktop/preload.cjs` exposes `window.meridianNative`. Save games are stored as gzip files in the user's data folder (`%APPDATA%/Meridian/saves` on Windows), and the main menu gets a Quit button. Without the bridge the game falls back to IndexedDB, so the browser build is unchanged.
- F11 toggles fullscreen. The window can't navigate away, and links open in the system browser.
- `npx playwright test e2e/desktop.spec.ts` launches the app and checks that it boots and saves to disk. Set `PACKAGED=1` to test the packaged `desktop/release/win-unpacked/Meridian.exe` instead.
- A Steamworks integration would go through the same bridge.

## Credits

Interface sounds (clicks, selections, panels opening and closing, errors and notifications) come from the free [Ultimate UI SFX Pack](https://jdsherbert.itch.io/) by JDSherbert, trimmed to their audible part in `public/assets/sfx/`. The city's background ambience is the *Urban ambient sound* recording from [Mixkit](https://mixkit.co/) (free licence), looped in `public/assets/ambience/`. Everything else you hear is synthesised at runtime.
