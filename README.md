# WeatherGlass

**Live forecasts turned into everyday decisions.** WeatherGlass answers the questions people actually check the weather for: *Do I need an umbrella? When is the best time to go for a run? Can I dry laundry outside? What should I wear? Is the air safe?* It also lets you compare all your cities side by side.

It runs as a Node.js backend that caches the weather APIs and fails over between them, with a fast, dependency-free HTML/CSS/JS frontend. It is deployed on two web servers (ALU sandboxes) behind an HAProxy load balancer.

| | |
|---|---|
| **Author** | Muhirwa Nathan |
| **Live app (load balancer)** | http://63e47b373378.d33531d3.alu-cod.online:58546/ |
| **Demo video (≤ 2 min)** | `<YouTube/Vimeo link>` ← *replace* |
| **Repository** | https://github.com/muhirwanathan/Weather |

---

## Table of contents
1. [Features](#features)
2. [Architecture](#architecture)
3. [APIs used & credits](#apis-used--credits)
4. [Run locally](#run-locally)
5. [Deployment](#deployment)
6. [Testing the load balancer](#testing-the-load-balancer)
7. [Zero-downtime updates & CI/CD](#zero-downtime-updates--cicd)
8. [Security](#security)
9. [Error handling](#error-handling)
10. [API reference](#api-reference)
11. [Project structure](#project-structure)
12. [Challenges & solutions](#challenges--solutions)
13. [Credentials for graders](#credentials-for-graders)

---

## Features

**Why it is useful.** A weather app that only shows numbers leaves the decision to you. WeatherGlass computes those decisions from the hourly forecast:

| Day planner card | How it is decided |
|---|---|
| Umbrella | Peak rain probability and thunderstorm risk over the next 12 h |
| Outdoor exercise | Scores every hour 0–100 (feels-like temperature, rain, wind, UV, daylight, storms) and recommends the best 2-hour window |
| What to wear | Feels-like temperature and wind |
| Sun protection | Highest UV index in the coming 12 h (WHO categories) |
| Laundry drying | Rain chance and humidity over the next daylight hours |
| Air quality | US AQI with health advice (EPA categories) |

**Working with the data**
- **Search** any city worldwide, with autocomplete (debounced, keyboard navigable: ↑ ↓ Enter Esc) and support for accents and non-Latin names.
- **My cities, compared:** save up to 10 cities and compare them in one table:
  - **Sort** by any column (city, condition, temperature, high, rain chance, wind, humidity, AQI). Click again to reverse.
  - **Filter** by text (name/country) and by condition (clear, cloudy, rain, snow, storm…).
  - Click a row to open that city.
- **Interactive 24 h chart:** switch between temperature, rain chance, wind and UV, with hover/touch tooltips.
- **7-day forecast** with temperature range bars. Tap a day for rain amount, max wind, sunrise/sunset and UV.
- **Details:** wind with direction arrow and gusts, humidity, feels-like, pressure trend, visibility, cloud cover, sun times, AQI meter with PM2.5.
- **°C / °F toggle**, use-my-location (on HTTPS), and preferences saved in the browser.
- **Readable at a glance:** the background follows the conditions and day/night, the icons are animated (and respect *reduced motion*), the layout works on phones, and the page is accessible (ARIA, keyboard, screen-reader chart summaries).

**Bonus features implemented**
- **Caching:** server-side TTL + LRU cache with request coalescing, plus HTTP cache headers.
- **Security:** strict Content-Security-Policy, Helmet headers, input validation, rate limiting, XSS-safe rendering, key kept server-side.
- **Provider failover:** automatic switch to OpenWeatherMap if Open-Meteo fails, plus stale-if-error.
- **Docker:** Dockerfile and a `docker-compose.yml` that recreates the 2 servers + load balancer setup locally.
- **CI/CD:** GitHub Actions runs tests on Node 20/22, builds and smoke-tests the Docker image, and can do a rolling zero-downtime deploy.
- **Data visualisation:** a dependency-free SVG chart.

---

## Architecture

```
                              ┌────────────────────────────────────────────┐
   Browser ── HTTP ─────────▶ │ Sandbox 1  63e47b373378…alu-cod.online     │
   :58546 (mapped to :80)     │                                            │
                              │  lb-01   HAProxy :80  round robin +        │
                              │          health checks on /api/health      │
                              │     │                          │           │
                              │     ▼                          │           │
                              │  web-01  nginx :8080           │           │
                              │            └▶ Node :3000 (pm2) │           │
                              └────────────────────────────────┼───────────┘
                                                               │ :44506 (mapped to :80)
                              ┌────────────────────────────────▼───────────┐
                              │ Sandbox 2  cb8ad26ec6c4…alu-cod.online     │
                              │  web-02  nginx :80                         │
                              │            └▶ Node :3000 (pm2)             │
                              └────────────────────────────────────────────┘
          both web servers:  cache ▸ failover ▸ stale-if-error
                                   ▼
        Open-Meteo (forecast, geocoding, air quality) ──fallback──▶ OpenWeatherMap
```

- The **browser only talks to our server**. Third-party APIs and keys are never exposed to the client.
- The server is **stateless**: user preferences live in the browser's localStorage, so either web server can answer any request. No sticky sessions are needed.
- Every response carries an `X-Served-By: web-01|web-02` header, and the page footer shows it too, so you can see the load balancing happen.

> **Why two sandboxes instead of three servers?** The deployment uses the ALU intranet sandboxes (Ubuntu 20.04), which allow two running at once. The load balancer therefore shares Sandbox 1 with web-01. HAProxy owns port 80 and web-01's nginx moves to port 8080. Traffic is still split 50/50 between two independent web servers on two separate machines, and either one can fail without taking the site down. The same scripts also work on three separate servers (see [Deploying on three dedicated servers](#deploying-on-three-dedicated-servers)).

---

## APIs used & credits

| API | Used for | Key? | Docs |
|---|---|---|---|
| **Open-Meteo Forecast API** (primary) | current, hourly (48 h), daily (7 d) weather, UV, visibility | No | https://open-meteo.com/en/docs |
| **Open-Meteo Geocoding API** | city search / autocomplete | No | https://open-meteo.com/en/docs/geocoding-api |
| **Open-Meteo Air Quality API** | US/EU AQI, PM2.5, PM10, O₃, NO₂ | No | https://open-meteo.com/en/docs/air-quality-api |
| **OpenWeatherMap** (failover) | current weather, 5-day/3-hour forecast, geocoding, air pollution | Yes | https://openweathermap.org/api |

- Weather data by **[Open-Meteo.com](https://open-meteo.com/)**, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Open-Meteo builds on data from national weather services (DWD, NOAA, Météo-France, ECMWF and others).
- Failover data by **[OpenWeather](https://openweathermap.org/)** (free tier, licensed under [CC BY-SA 4.0](https://openweathermap.org/full-price#licenses)).
- Weather code meanings: [WMO code table 4677](https://open-meteo.com/en/docs) (as documented by Open-Meteo).
- AQI categories: [US EPA AirNow](https://www.airnow.gov/aqi/aqi-basics/). UV categories: [WHO UV index](https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-(uv)-index).

**Libraries:** [Express](https://expressjs.com/), [Helmet](https://helmetjs.github.io/), [compression](https://github.com/expressjs/compression), [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit), [dotenv](https://github.com/motdotla/dotenv). **Infrastructure:** [nginx](https://nginx.org/), [HAProxy](https://www.haproxy.org/), [Docker](https://www.docker.com/), [GitHub Actions](https://docs.github.com/actions). Icons, chart and UI are hand-written SVG/CSS (no UI libraries).

**Rate limits respected:** Open-Meteo allows 10,000 calls/day for non-commercial use, and OpenWeatherMap's free tier allows 60 calls/min. The 10-minute server cache, ~1 km coordinate rounding and request coalescing keep usage far below both, and our own API is rate-limited to 120 requests/min per client IP.

---

## Run locally

**Requirements:** Node.js 20 or newer ([download](https://nodejs.org/)), git.

```bash
git clone https://github.com/muhirwanathan/Weather.git
cd Weather
npm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
# optional: put your OpenWeatherMap key in .env -> OPENWEATHER_API_KEY=...
npm start
```

Open **http://localhost:3000**. The app works without any key (Open-Meteo is keyless); the key only enables the failover provider.

```bash
npm test        # 22 unit + integration tests (no internet needed: providers are faked)
npm run dev     # auto-restart on file changes
```

**Run the full load-balanced setup locally with Docker:**
```bash
docker compose up --build
# open http://localhost:8080 and refresh: the footer alternates between web-01 and web-02
```

---

## Deployment

| Role | Sandbox host | Internal port | Public URL |
|---|---|---|---|
| **lb-01** (HAProxy) | `63e47b373378.d33531d3.alu-cod.online` | 80 | **http://63e47b373378.d33531d3.alu-cod.online:58546/** ← the app |
| **web-01** (nginx → Node) | `63e47b373378.d33531d3.alu-cod.online` | 8080 | http://63e47b373378.d33531d3.alu-cod.online:58538/ |
| **web-02** (nginx → Node) | `cb8ad26ec6c4.1de0cb85.alu-cod.online` | 80 | http://cb8ad26ec6c4.1de0cb85.alu-cod.online:44506/ |

Each sandbox exposes its internal ports through the intranet's port mapping (for example, Sandbox 2 maps HTTP :80 to public port 44506). That is how the load balancer reaches web-02.

Sandboxes have **no systemd**, so the app runs under **[pm2](https://pm2.keymetrics.io/)**, which keeps Node alive and restarts it if it crashes. nginx and HAProxy are started with `service`.

### 1. web-02 (Sandbox 2)

Open **Webterm** on Sandbox 2, or SSH in with `ssh -p 44507 <username>@cb8ad26ec6c4.1de0cb85.alu-cod.online`, then:

```bash
git clone https://github.com/muhirwanathan/Weather.git weatherglass
cd weatherglass
bash deploy/sandbox/setup-web.sh web-02 80
nano .env        # paste OPENWEATHER_API_KEY=..., then: pm2 restart weatherglass --update-env
```

### 2. web-01 (Sandbox 1)

Open **Webterm** on Sandbox 1, or SSH in with `ssh -p 58547 <username>@63e47b373378.d33531d3.alu-cod.online`, then:

```bash
git clone https://github.com/muhirwanathan/Weather.git weatherglass
cd weatherglass
bash deploy/sandbox/setup-web.sh web-01 8080
nano .env        # paste OPENWEATHER_API_KEY=..., then: pm2 restart weatherglass --update-env
```

What [deploy/sandbox/setup-web.sh](deploy/sandbox/setup-web.sh) does:
1. Installs nginx, git and **Node.js 20** (NodeSource), plus `pm2`.
2. Runs `npm ci --omit=dev` and creates `.env` from `.env.example` with `SERVER_NAME=web-0X` and `TRUST_PROXY=2` (HAProxy + nginx sit in front of Node). `.env` is set to `chmod 600`.
3. Starts the app with `pm2 start server.js --name weatherglass` and saves the process list.
4. Installs [deploy/nginx/weatherglass.conf](deploy/nginx/weatherglass.conf) on the given port. nginx reverse-proxies to `127.0.0.1:3000` and forwards `X-Forwarded-For`, so the app sees the real client IP for rate limiting.
5. Checks `/api/health` and prints the result.

### 3. lb-01 (Sandbox 1, after web-01)

```bash
cd ~/weatherglass
bash deploy/setup-lb.sh 127.0.0.1:8080 cb8ad26ec6c4.1de0cb85.alu-cod.online:44506
```

[deploy/setup-lb.sh](deploy/setup-lb.sh) installs HAProxy, fills the two backend addresses into [deploy/haproxy/haproxy.cfg](deploy/haproxy/haproxy.cfg), validates it (`haproxy -c`), starts it on port 80, and checks that both backends answer. Key settings:

| Setting | Why |
|---|---|
| `balance roundrobin` | Requests alternate evenly between web-01 and web-02 |
| `option httpchk GET /api/health`, `expect status 200` | Active health checks: an app that is down is detected even if nginx is still up |
| `inter 3s fall 2 rise 2` | A failed server leaves the pool within ~6 s and rejoins after 2 passing checks |
| `option redispatch`, `retries 2` | If a server fails mid-request, the request is retried on the other server |
| `option forwardfor` | Adds `X-Forwarded-For` with the client IP |
| `X-Load-Balancer: lb-01` header | Proves the response passed through the LB |

The config uses syntax that works with HAProxy 2.0 (the Ubuntu 20.04 package) and newer.

### After a sandbox restart

Nothing starts automatically in a sandbox. After using **Restart** in the intranet, run this on each sandbox:
```bash
cd ~/weatherglass && bash deploy/sandbox/start-all.sh
```
It restores the pm2 app and starts nginx (and HAProxy on Sandbox 1).

### Deploying on three dedicated servers

On full Ubuntu servers with systemd (separate Web01, Web02 and Lb01), use the production scripts instead:
```bash
# on Web01 and Web02 (runs the app as an unprivileged user under systemd, nginx on :80)
sudo bash deploy/setup-web.sh https://github.com/muhirwanathan/Weather.git web-01   # web-02 on the other
# on Lb01
sudo bash deploy/setup-lb.sh WEB01_IP WEB02_IP
```
See [deploy/systemd/weatherglass.service](deploy/systemd/weatherglass.service) for the hardened service unit (`ProtectSystem=strict`, `NoNewPrivileges`, graceful stop).

---

## Testing the load balancer

**1. Traffic alternates between the servers.**
```bash
for i in $(seq 1 6); do
  curl -s -o /dev/null -D - http://63e47b373378.d33531d3.alu-cod.online:58546/api/health | grep -i x-served-by
done
# X-Served-By: web-01
# X-Served-By: web-02
# X-Served-By: web-01 ...
```
In the browser, refresh the page and watch the footer change between "Served by web-01" and "Served by web-02".

**2. Each web server works on its own.**
```bash
curl http://63e47b373378.d33531d3.alu-cod.online:58538/api/health   # {"status":"ok","server":"web-01",...}
curl http://cb8ad26ec6c4.1de0cb85.alu-cod.online:44506/api/health   # {"status":"ok","server":"web-02",...}
```

**3. Failover works.** Stop the app on web-02 (Sandbox 2):
```bash
pm2 stop weatherglass
```
Within about 6 seconds every request through the load balancer is answered by web-01, and the site stays up. Start it again with `pm2 start weatherglass`, and web-02 rejoins after two passing health checks.

**4. Full functionality through the LB:** search a city, sort/filter the comparison table and switch units at the load balancer URL.

---

## Zero-downtime updates & CI/CD

Update one server at a time with [deploy/sandbox/update.sh](deploy/sandbox/update.sh), which pulls the code, runs `npm ci`, restarts pm2 and waits for `/api/health`:

```bash
# Sandbox 2 first
cd ~/weatherglass && bash deploy/sandbox/update.sh 80      # wait for "healthy"
# then Sandbox 1
cd ~/weatherglass && bash deploy/sandbox/update.sh 8080
```
While one server restarts, HAProxy's health check takes it out of rotation and sends all traffic to the other one. Node also finishes in-flight requests on `SIGTERM` before exiting. On dedicated servers, [deploy/rolling-deploy.sh](deploy/rolling-deploy.sh) does the same over SSH.

**GitHub Actions** ([.github/workflows/ci.yml](.github/workflows/ci.yml)), on every push/PR:
1. Run `npm test` on Node 20 and 22, plus syntax check and `npm audit`.
2. Build the Docker image and smoke-test `/api/health` inside the container.
3. Optional rolling deploy to dedicated servers when the repo variable `DEPLOY_ENABLED=true` and the SSH secrets are set.

---

## Security

- **API keys never leave the server.** They are read from `.env` (git-ignored, `chmod 600`) and only added to outgoing requests in [src/providers/openWeatherMap.js](src/providers/openWeatherMap.js). The browser only calls `/api/*`. `.env.example` documents the variables without any values.
- **Input validation** ([src/validate.js](src/validate.js)): coordinates must be decimal numbers within valid ranges, and search text is limited to 2–80 characters drawn from letters (any alphabet), digits, spaces and `. , ' - ( )`. Anything else gets a clear HTTP 400.
- **XSS:** the frontend never uses `innerHTML`. All data is inserted with `textContent`. On top of that, a strict **Content-Security-Policy** (`script-src 'self'`, no inline scripts or styles) blocks injected scripts even if a bug slipped through.
- **Helmet** headers: `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors 'none'` (clickjacking), `Referrer-Policy`, and `x-powered-by` removed.
- **Rate limiting:** 120 requests/min per client IP on `/api`. It is proxy-aware (`TRUST_PROXY`), so limits apply to real users rather than the load balancer's IP.
- **No SQL / no database**, so there is no injection surface. Upstream URLs are built with `URLSearchParams` (no string concatenation of user input).
- **Error messages** never leak stack traces or internal provider details.
- **Least privilege:** on dedicated servers the app runs as an unprivileged system user with systemd sandboxing; the Docker image runs as `node`, not root; Node only listens behind nginx.

---

## Error handling

| Situation | What the user sees |
|---|---|
| Upstream slow/down | 6 s timeout, 1 retry with backoff, then **automatic switch to OpenWeatherMap** (badge: *Backup provider in use*) |
| All providers down, data cached before | Last good forecast served, flagged **Stale data** + banner explaining it |
| All providers down, nothing cached | Friendly HTTP 503 message + **Retry** button |
| Air-quality API fails | Forecast still shown; AQI card simply hidden |
| Browser offline / server unreachable | Last forecast saved in the browser is shown with *Offline copy · 5 min ago*; reloads automatically when back online |
| Invalid search / no matches | Inline hint ("Type at least 2 characters", "No places match …") |
| Too many requests | "Too many requests. Please wait a minute" (HTTP 429) |
| Location denied / not on HTTPS | Explains why and suggests searching instead |
| One city fails in comparison | Only that row shows an error; the others load normally |

---

## API reference

All endpoints are `GET` and return JSON. Errors look like `{"error":{"code":"INVALID_INPUT","message":"..."}}`.

| Endpoint | Description |
|---|---|
| `/api/health` | `{status, server, uptimeSeconds, providers, cache:{entries,hits,misses,hitRate}}` (used by HAProxy) |
| `/api/geocode?q=Kigali` | Up to 8 matching places `{name, region, country, lat, lon, timezone, population}` |
| `/api/weather?lat=-1.95&lon=30.06` | `current`, `hourly` (48 h), `daily` (7 d), `airQuality`, `insights` (summary + planner), plus `provider`, `cached`, `stale`, `fallback` flags |
| `/api/compare?points=-1.95,30.06\|51.51,-0.13` | Summary row per point (max 10) |

---

## Project structure

```
├── server.js                  # entry point: config, providers, graceful shutdown
├── src/
│   ├── app.js                 # Express app: security, rate limit, routes, error handler
│   ├── weatherService.js      # cache + provider failover + stale-if-error
│   ├── providers/
│   │   ├── openMeteo.js       # primary provider (no key)
│   │   └── openWeatherMap.js  # failover provider (API key, server-side only)
│   ├── insights.js            # day-planner logic (umbrella, exercise, laundry, ...)
│   ├── cache.js               # TTL + LRU cache with request coalescing
│   ├── conditions.js          # WMO weather codes + OpenWeatherMap mapping
│   ├── validate.js            # input validation
│   ├── http.js                # fetch with timeout + retry
│   ├── errors.js, config.js
├── public/                    # frontend (no build step, no framework)
│   ├── index.html             # markup + SVG icon sprite
│   ├── css/styles.css
│   └── js/ app.js, api.js, chart.js, format.js, store.js
├── test/                      # node:test unit + integration tests
├── deploy/                    # nginx, HAProxy, systemd, setup & rolling-deploy scripts
├── Dockerfile, docker-compose.yml
└── .github/workflows/ci.yml
```

---

## Challenges & solutions

1. **Hiding the API key in a browser app.** A pure frontend would have to ship the key to every visitor. *Solution:* a small Node backend acts as a proxy, so the key only exists in the server's `.env`.
2. **APIs go down or get slow.** *Solution:* timeouts and retries, a second provider behind a common data format (OpenWeatherMap condition IDs are mapped to WMO codes and its 3-hourly forecast is grouped into days), stale-if-error, and an offline copy in the browser.
3. **Staying under free-tier rate limits.** *Solution:* a 10-minute cache keyed by coordinates rounded to ~1 km, so "Kigali" from 100 users is one upstream call. Request coalescing covers the case where they all ask at the same moment. Unit conversion happens in the browser, so °C and °F users share the same cached data.
4. **Time zones.** Showing Tokyo's hourly forecast from Kigali through the browser's `Date` shifts every hour. *Solution:* the API returns *location-local* time strings, and the frontend formats them as text without timezone conversion.
5. **Two servers, one experience.** Server-side sessions would break when HAProxy alternates servers. *Solution:* a stateless backend, with preferences stored in the browser, so any server can answer any request.
6. **Real client IPs behind two proxies.** Without care, every user shares the load balancer's IP and the rate limiter blocks everyone at once. *Solution:* `option forwardfor` in HAProxy, `$proxy_add_x_forwarded_for` in nginx, and `trust proxy = 2` in Express.
7. **Updating without downtime.** *Solution:* graceful shutdown, HAProxy health checks and a one-server-at-a-time rolling deploy.
8. **CSP vs. dynamic UI.** A strict CSP forbids inline styles and scripts. *Solution:* all JS/CSS lives in external files, and dynamic positions (chart, bars) are set through the CSSOM (`element.style`), which CSP allows.
9. **Only two sandboxes and no systemd.** The intranet sandboxes allow two running containers and don't run systemd. *Solution:* the load balancer shares Sandbox 1 with web-01 (HAProxy on :80, web-01's nginx on :8080). HAProxy reaches web-02 through Sandbox 2's public port mapping (:44506), pm2 replaces systemd, and `start-all.sh` brings everything back after a sandbox restart.
10. **HAProxy 2.0 on Ubuntu 20.04.** The newer `http-check send` syntax isn't supported there. *Solution:* the config uses the `option httpchk GET /api/health HTTP/1.1` form, which works on both old and new versions.

---

## Credentials for graders

- **Login:** none. The app has no user accounts, so no login is required. Preferences are stored in your browser.
- **Server access:** the app is public at the load balancer URL above. Sandbox SSH passwords are not published here.
- **API keys:** Open-Meteo needs **no key**. The optional OpenWeatherMap failover key is **provided in the assignment submission comment** (never committed). To use it locally, put it in `.env` as `OPENWEATHER_API_KEY=...`.
