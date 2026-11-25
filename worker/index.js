// SavePoint API: multi-source game catalogue, artwork and clean developer names.
// Required Worker secrets: RAWG_API_KEY, THEGAMESDB_API_KEY, STEAMGRIDDB_API_KEY.
// Routes: /health, /search, /game, /hot, /upcoming, /similar.

const BASE = "https://api.rawg.io/api";
const cache = new Map();

const ALIASES = {
  p5x: ["Persona 5: The Phantom X"],
  p5r: ["Persona 5 Royal"],
  p5: ["Persona 5"],
  smtvv: ["Shin Megami Tensei V: Vengeance"],
  smtv: ["Shin Megami Tensei V"],
  smt: ["Shin Megami Tensei"],
  ff7r: ["Final Fantasy VII Remake"],
  ff7rebirth: ["Final Fantasy VII Rebirth"],
  ff16: ["Final Fantasy XVI"],
  ff15: ["Final Fantasy XV"],
  ff14: ["Final Fantasy XIV"],
  ff10: ["Final Fantasy X"],
  got: ["Ghost of Tsushima"],
  gow: ["God of War"],
  tlou: ["The Last of Us"],
  tlou2: ["The Last of Us Part II"],
  re4: ["Resident Evil 4"],
  re8: ["Resident Evil Village"],
  ac: ["Assassin's Creed"],
  ac6: ["Armored Core VI: Fires of Rubicon"],
  zeldaoot: ["The Legend of Zelda: Ocarina of Time"],
  oot: ["The Legend of Zelda: Ocarina of Time"],
  botw: ["The Legend of Zelda: Breath of the Wild"],
  totk: ["The Legend of Zelda: Tears of the Kingdom"],
  kh: ["Kingdom Hearts"],
  kh3: ["Kingdom Hearts III"],
  dmc5: ["Devil May Cry 5"],
  ds3: ["Dark Souls III"],
  er: ["Elden Ring"],
  mhw: ["Monster Hunter: World"],
  mhwib: ["Monster Hunter World: Iceborne"],
  mhrise: ["Monster Hunter Rise"]
};

const STOP = new Set(["the", "of", "and", "a", "an", "to", "in", "for", "on"]);

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return json({ error: "method" }, 405, cors);

    const url = new URL(request.url);
    try {
      if (url.pathname === "/" || url.pathname === "/health") {
        return json({ ok: true, name: "savepoint-api", provider: "RAWG + Steam + TheGamesDB + SteamGridDB" }, 200, cors);
      }
      if (!env.RAWG_API_KEY) throw new Error("RAWG_API_KEY secret is missing");

      let data, ttl = 300;
      if (url.pathname === "/search") {
        const q = clean(url.searchParams.get("q"));
        if (q.length < 2) return json([], 200, cors);
        ttl = 900;
        data = await cached("search:" + norm(q), ttl, () => search(q, env));
      } else if (url.pathname === "/game") {
        const rawId = String(url.searchParams.get("id") || "");
        ttl = 21600;
        if (rawId.startsWith("steam-")) {
          const steamId = num(rawId.slice(6));
          if (!steamId) return json({ error: "id" }, 400, cors);
          data = await cached("game:" + rawId, ttl, async () => {
            const game = await steamGame({ id: steamId, name: "" });
            return game ? shapeSteam(game) : {};
          });
        } else if (rawId.startsWith("tgdb-")) {
          const tgdbId = num(rawId.slice(5));
          if (!tgdbId || !env.THEGAMESDB_API_KEY) return json({ error: "id" }, 400, cors);
          data = await cached("game:" + rawId, ttl, async () => {
            const game = await theGamesDbById(tgdbId, env);
            return game ? shapeTheGamesDb(game) : {};
          });
        } else {
          const id = num(rawId);
          if (!id) return json({ error: "id" }, 400, cors);
          data = await cached("game:" + id, ttl, async () => {
            const g = await rawg("/games/" + id, env);
            return g ? shape(g) : {};
          });
        }
      } else if (url.pathname === "/hot") {
        ttl = 1800;
        data = await cached("hot", ttl, () => latestHits(env));
      } else if (url.pathname === "/upcoming") {
        ttl = 1800;
        data = await cached("upcoming", ttl, () => upcoming(env));
      } else if (url.pathname === "/similar") {
        const name = clean(url.searchParams.get("name"));
        const id = String(url.searchParams.get("id") || "");
        const ids = String(url.searchParams.get("ids") || "");
        if (!name && !id && !ids) return json([], 200, cors);
        ttl = 21600;
        if (ids) {
          const idList = ids.split(",").map(s => s.trim()).filter(Boolean).slice(0, 6);
          data = await cached("similar-ids:" + idList.join(","), ttl, async () => {
            const batches = await Promise.all(idList.map(gid => similarGames("", gid, env).catch(() => [])));
            const seen = new Set(idList);
            const out = [];
            for (const list of batches) {
              for (const g of list) {
                if (g?.id && !seen.has(String(g.id))) {
                  seen.add(String(g.id));
                  out.push(g);
                }
              }
            }
            return out.slice(0, 12);
          });
        } else {
          data = await cached("similar:" + norm(id || name), ttl, () => similarGames(name, id, env));
        }
      } else {
        return json({ error: "not found" }, 404, cors);
      }
      return json(data, 200, { ...cors, "Cache-Control": `public, max-age=${Math.min(ttl, 600)}` });
    } catch (error) {
      return json({ error: String(error?.message || error) }, 502, cors);
    }
  }
};


async function search(query, env) {
  const qn = norm(query);
  const compact = qn.replace(/\s+/g, "");
  const aliases = ALIASES[compact] || ALIASES[qn] || [];
  const terms = [...new Set([query, ...aliases])].slice(0, 4);
  const found = new Map();

  // Search RAWG and Steam in parallel. RAWG has broad metadata coverage; Steam
  // fills gaps for PC releases and can provide dedicated portrait library artwork.
  const [batches, steamLists, tgdbLists] = await Promise.all([
    Promise.all(terms.map(t =>
      rawg("/games", env, { search: t, page_size: "40", ordering: "-added" })
        .then(x => x.results || []).catch(() => [])
    )),
    Promise.all(terms.slice(0, 2).map(t => steamSearch(t).catch(() => []))),
    env.THEGAMESDB_API_KEY
      ? Promise.all(terms.slice(0, 3).map(t => theGamesDbSearch(t, env).catch(() => [])))
      : Promise.resolve([])
  ]);
  for (const list of batches) for (const game of list) {
    if (game?.id) found.set(game.id, game);
  }

  const steamGames = new Map();
  for (const list of steamLists) for (const item of list) {
    if (item?.id && item?.name) steamGames.set(item.id, item);
  }
  const steamDetails = await Promise.all([...steamGames.values()].slice(0, 8).map(item =>
    steamGame(item).catch(() => null)
  ));
  const steamByName = new Map();
  for (const game of steamDetails.filter(Boolean)) {
    steamByName.set(norm(game.name), game);
  }

  // TheGamesDB extends coverage for console and retro libraries (3DS, DS,
  // GBA, GBC, PS1/PS2, and other platforms). It also supplies box-art metadata.
  const tgdbGames = new Map();
  for (const list of tgdbLists) for (const game of list) {
    if (game?.id) tgdbGames.set(game.id, game);
  }

  // Company discovery: if the query resembles a developer or publisher, show their games too.
  const [devs, pubs] = await Promise.all([
    rawg("/developers", env, { search: query, page_size: "8" }).then(x => x.results || []).catch(() => []),
    rawg("/publishers", env, { search: query, page_size: "8" }).then(x => x.results || []).catch(() => [])
  ]);
  const exactDevs = devs.filter(x => companyMatch(query, x.name)).slice(0, 3);
  const exactPubs = pubs.filter(x => companyMatch(query, x.name)).slice(0, 3);

  const companyJobs = [];
  for (const d of exactDevs) companyJobs.push(
    rawg("/games", env, { developers: String(d.id), page_size: "30", ordering: "-added" })
      .then(x => ({ kind: "Developer", company: d.name, games: x.results || [] })).catch(() => null)
  );
  for (const p of exactPubs) companyJobs.push(
    rawg("/games", env, { publishers: String(p.id), page_size: "30", ordering: "-added" })
      .then(x => ({ kind: "Publisher", company: p.name, games: x.results || [] })).catch(() => null)
  );
  const companyResults = (await Promise.all(companyJobs)).filter(Boolean);
  const companyInfo = new Map();
  for (const batch of companyResults) for (const game of batch.games) {
    if (!game?.id) continue;
    found.set(game.id, found.get(game.id) || game);
    companyInfo.set(game.id, `${batch.kind}: ${batch.company}`);
  }

  const tgdbRanked = [...tgdbGames.values()].map(g => {
    const title = norm(g.game_title);
    let score = scoreTitle(qn, title);
    for (const a of terms.map(norm)) score = Math.max(score, scoreTitle(a, title));
    if ((g.alternates || []).some(a => norm(a) === qn)) score = Math.max(score, 1050);
    return { game: g, score, company: "", steam: null, source: "tgdb" };
  });

  const aliasSet = new Set(terms.map(norm));
  const ranked = [...found.values()].map(g => {
    const title = norm(g.name);
    let score = scoreTitle(qn, title);
    for (const a of aliasSet) score = Math.max(score, scoreTitle(a, title));
    if (companyInfo.has(g.id)) score = Math.max(score, 500);
    const steam = steamByName.get(title);
    return { game: g, score, company: companyInfo.get(g.id) || "", steam };
  });

  // Include Steam-only results (e.g. newer PC releases missing from RAWG).
  const rawgNames = new Set([...found.values()].map(g => norm(g.name)));
  for (const steam of steamByName.values()) {
    const title = norm(steam.name);
    if (rawgNames.has(title)) continue;
    let score = scoreTitle(qn, title);
    for (const a of aliasSet) score = Math.max(score, scoreTitle(a, title));
    if (score >= 170) ranked.push({
      game: {
        id: `steam-${steam.id}`, name: steam.name, released: steam.releaseDate || "",
        background_image: steam.headerImage || "", genres: steam.genres || [],
        developers: steam.developers || [], publishers: steam.publishers || [],
        platforms: [{ platform: { name: "PC" } }],
        description_raw: steam.description || "", website: steam.website || ""
      },
      score, company: "", steam
    });
  }

  // Add TheGamesDB-only titles and merge its platforms/box art into an existing
  // exact-title result where possible, avoiding duplicate cards for the same game.
  const byTitle = new Map(ranked.map(x => [norm(x.game.name), x]));
  for (const item of tgdbRanked) {
    if (item.score < 170) continue;
    const title = norm(item.game.game_title);
    const existing = byTitle.get(title);
    if (existing) {
      const tg = shapeTheGamesDb(item.game);
      existing.tgdb = item.game;
      existing.tgdbShape = tg;
    } else {
      const synthetic = {
        id: `tgdb-${item.game.id}`,
        name: item.game.game_title || "",
        released: item.game.release_date || "",
        background_image: "",
        genres: [],
        developers: [],
        publishers: [],
        platforms: [{ platform: { name: item.game.platformName || "Console" } }],
        description_raw: item.game.overview || "",
        website: ""
      };
      const entry = { game: synthetic, score: item.score, company: "", steam: null, source: "tgdb", tgdb: item.game };
      ranked.push(entry);
      byTitle.set(title, entry);
    }
  }

  // Company mode: preserve the full company catalogue, ranked by current RAWG activity.
  const isCompanySearch = companyResults.some(b => b.games.length);
  ranked.sort((a, b) => isCompanySearch && b.score === a.score
    ? activity(b.game) - activity(a.game)
    : b.score - a.score || activity(b.game) - activity(a.game));

  const filtered = isCompanySearch
    ? ranked.filter(x => x.score >= 350)
    : ranked.filter(x => x.score >= 170);

  const output = filtered.slice(0, 30).map(x => {
    const item = x.source === "tgdb" ? shapeTheGamesDb(x.tgdb) : shape(x.game);
    // Artwork priority: official-looking TheGamesDB front box art, Steam's
    // portrait library image, then SteamGridDB portrait artwork, then RAWG art.
    if (x.tgdb) {
      const tg = x.tgdbShape || shapeTheGamesDb(x.tgdb);
      if (tg.cover) item.cover = tg.cover;
      item.platforms = mergePlatforms(item.platforms || [], tg.platforms || []);
      if (!item.summary && tg.summary) item.summary = tg.summary;
    }
    if (x.steam?.portraitCover) item.cover = x.steam.portraitCover;
    if (x.company) item.match = x.company;
    return item;
  });

  // SteamGridDB is an artwork fallback/upgrade, not a separate game catalogue.
  if (env.STEAMGRIDDB_API_KEY) {
    const artworkJobs = output.slice(0, 20).map(async (item, index) => {
      const source = filtered[index];
      const hasPreferredCover = Boolean(source?.tgdbShape?.cover || source?.tgdb?.boxartUrl || source?.steam?.portraitCover);
      if (hasPreferredCover) return;
      const art = await steamGridArtwork(item.name, env).catch(() => "");
      if (art) item.cover = art;
    });
    await Promise.all(artworkJobs);
  }
  return output;
}

function mapTgdbCompanies(ids, dict) {
  if (!Array.isArray(ids) || !dict) return "";
  return ids
    .map(id => dict[String(id)]?.name || "")
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
}

async function theGamesDbSearch(query, env) {
  const url = new URL("https://api.thegamesdb.net/v1.1/Games/ByGameName");
  url.searchParams.set("apikey", env.THEGAMESDB_API_KEY);
  url.searchParams.set("name", query);
  url.searchParams.set("fields", "overview,alternates,publishers,developers,genres");
  url.searchParams.set("include", "boxart,platform,publishers,developers");
  url.searchParams.set("page", "1");
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`TheGamesDB ${response.status}`);
  const payload = await response.json();
  const games = payload?.data?.games || [];
  const boxart = payload?.include?.boxart;
  const platforms = payload?.include?.platform?.data || payload?.include?.platform || {};
  const devs = payload?.include?.developers?.data || payload?.include?.developers || {};
  const pubs = payload?.include?.publishers?.data || payload?.include?.publishers || {};
  return games.map(g => {
    const images = boxart?.data?.[String(g.id)] || [];
    const front = images.find(i => i.type === "boxart" && i.side === "front") ||
      images.find(i => i.type === "boxart") || null;
    const platform = platforms?.[String(g.platform)] || {};
    return {
      ...g,
      devNames: mapTgdbCompanies(g.developers, devs),
      pubNames: mapTgdbCompanies(g.publishers, pubs),
      platformName: platform.name || `Platform ${g.platform || ""}`.trim(),
      boxartUrl: front && boxart?.base_url?.original
        ? boxart.base_url.original + front.filename : ""
    };
  });
}

async function theGamesDbById(id, env) {
  const url = new URL("https://api.thegamesdb.net/v1/Games/ByGameID");
  url.searchParams.set("apikey", env.THEGAMESDB_API_KEY);
  url.searchParams.set("id", String(id));
  url.searchParams.set("fields", "overview,alternates,publishers,developers,genres");
  url.searchParams.set("include", "boxart,platform,publishers,developers");
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`TheGamesDB ${response.status}`);
  const payload = await response.json();
  const game = payload?.data?.games?.[0];
  if (!game) return null;
  const boxart = payload?.include?.boxart;
  const images = boxart?.data?.[String(id)] || [];
  const front = images.find(i => i.type === "boxart" && i.side === "front") ||
    images.find(i => i.type === "boxart") || null;
  const platforms = payload?.include?.platform?.data || payload?.include?.platform || {};
  const devs = payload?.include?.developers?.data || payload?.include?.developers || {};
  const pubs = payload?.include?.publishers?.data || payload?.include?.publishers || {};
  const platform = platforms?.[String(game.platform)] || {};
  return {
    ...game,
    devNames: mapTgdbCompanies(game.developers, devs),
    pubNames: mapTgdbCompanies(game.publishers, pubs),
    platformName: platform.name || `Platform ${game.platform || ""}`.trim(),
    boxartUrl: front && boxart?.base_url?.original
      ? boxart.base_url.original + front.filename : ""
  };
}


/* ---- developer detection: one clean name per game ---- */
const devKey = (n) =>
  String(n || "").toLowerCase().replace(/&/g, " and ").replace(/[.,]/g, " ")
    .replace(/\b(co|ltd|inc|llc|corp|corporation|limited|gmbh|kk|company)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const ATLUS_FAMILY = /^(atlus( west| usa| u s a| of america)?|p studio|studio zero)$/;
const normT = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
function atlusFirstParty(title) {
  const t = normT(title);
  if (/^(persona 5 (strikers|scramble|the phantom x)|persona 4 arena)/.test(t)) return false;
  return /^(persona (3|4|5)\b|persona q|shin megami tensei|metaphor refantazio|catherine|soul hackers|devil survivor|etrian odyssey|raidou|digital devil saga|radiant historia|trauma center|devil summoner)/.test(t);
}
function canonDev(v, title) {
  const raw = String(v || "").replace(/,\s*(ltd|inc|llc|co|corp|limited|gmbh)\b\.?/gi, "").split(",").map((x) => x.trim()).filter(Boolean);
  const out = [], seen = {};
  for (let n of raw) {
    let k = devKey(n);
    if (ATLUS_FAMILY.test(k)) { n = "ATLUS"; k = "atlus"; }
    if (!k || seen[k]) continue;
    seen[k] = 1; out.push(n);
  }
  if (atlusFirstParty(title) && !seen.atlus) out.unshift("ATLUS");
  return out.slice(0, 3).join(", ");
}

function shapeTheGamesDb(g) {
  const released = g.release_date || "";
  return {
    id: `tgdb-${g.id}`,
    name: g.game_title || "",
    year: released ? released.slice(0, 4) : "",
    date: released,
    cover: g.boxartUrl || "",
    genres: "",
    dev: canonDev(g.devNames || "", g.game_title || ""),
    pub: g.pubNames || "",
    platforms: g.platformName ? [g.platformName] : [],
    summary: g.overview || "",
    links: [],
    similar: []
  };
}

function mergePlatforms(a, b) {
  return [...new Set([...a, ...b])];
}

function looksLandscape(url) {
  // RAWG often supplies landscape screenshots; prefer dedicated portrait art.
  return /background|header|capsule|hero/i.test(String(url || ""));
}

async function steamGridArtwork(title, env) {
  const headers = { Authorization: `Bearer ${env.STEAMGRIDDB_API_KEY}` };
  const searchUrl = `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(title)}`;
  const searchResponse = await fetch(searchUrl, { headers });
  if (!searchResponse.ok) return "";
  const searchPayload = await searchResponse.json();
  const hits = searchPayload?.data || [];
  const match = hits.find(g => norm(g.name) === norm(title));
  if (!match?.id) return "";
  const gridsUrl = new URL(`https://www.steamgriddb.com/api/v2/grids/game/${match.id}`);
  gridsUrl.searchParams.set("dimensions", "600x900");
  gridsUrl.searchParams.set("types", "static");
  const gridsResponse = await fetch(gridsUrl.toString(), { headers });
  if (!gridsResponse.ok) return "";
  const gridsPayload = await gridsResponse.json();
  const grids = gridsPayload?.data || [];
  return grids.find(g => g.url)?.url || grids.find(g => g.thumb)?.thumb || "";
}

function scoreTitle(query, title) {
  if (!query || !title) return 0;
  if (title === query) return 1200;
  if (title.startsWith(query)) return 950;
  if (title.includes(query)) return 800;
  const qt = query.split(" ").filter(Boolean);
  const tt = title.split(" ").filter(Boolean);
  const overlap = qt.filter(t => tt.includes(t)).length;
  let score = qt.length ? overlap / qt.length * 500 : 0;
  const initials = tt.filter(t => !STOP.has(t)).map(t => t[0]).join("");
  if (initials === query.replace(/\s/g, "")) score = Math.max(score, 900);
  if (initials.startsWith(query.replace(/\s/g, ""))) score = Math.max(score, 760);
  if (editDistance(query, title) <= 2 && query.length >= 5) score = Math.max(score, 420);
  return score;
}

function shapeSteam(g) {
  return {
    id: `steam-${g.id}`,
    name: g.name || "",
    year: g.releaseDate ? String(g.releaseDate).match(/\d{4}/)?.[0] || "" : "",
    date: g.releaseDate || "",
    cover: g.portraitCover || g.headerImage || "",
    genres: (g.genres || []).join(", "),
    dev: canonDev((g.developers || []).join(", "), g.name || ""),
    pub: (g.publishers || []).slice(0, 3).join(", "),
    platforms: ["PC"],
    summary: g.description || "",
    links: g.website ? [g.website] : [],
    similar: []
  };
}

function shape(g) {
  const released = g.released || "";
  const platforms = (g.platforms || []).map(p => p.platform?.name).filter(Boolean);
  return {
    id: g.id,
    name: g.name || "",
    year: released ? released.slice(0, 4) : "",
    date: released,
    cover: g.background_image || "",
    genres: (g.genres || []).map(x => x.name).join(", "),
    dev: canonDev((g.developers || []).map(x => x.name).join(", "), g.name || ""),
    pub: (g.publishers || []).map(x => x.name).slice(0, 3).join(", "),
    platforms,
    summary: g.description_raw || "",
    links: g.website ? [g.website] : [],
    similar: []
  };
}

async function similarGames(name, id, env) {
  let rawgId = "";
  let sourceName = name;
  const cleanId = String(id || "").trim();
  if (/^\d+$/.test(cleanId)) rawgId = cleanId;
  if (!rawgId && sourceName) {
    const found = await rawg("/games", env, { search: sourceName, page_size: "8" });
    const results = found.results || [];
    const exact = results.find(g => norm(g.name) === norm(sourceName));
    const candidate = exact || results[0];
    if (candidate) rawgId = String(candidate.id);
  }
  if (!rawgId) return [];

  const [seriesRes, suggestedRes, base] = await Promise.all([
    rawg("/games/" + rawgId + "/game-series", env, { page_size: "12" }).catch(() => ({ results: [] })),
    rawg("/games/" + rawgId + "/suggested", env, { page_size: "12", ordering: "-added" }).catch(() => ({ results: [] })),
    rawg("/games/" + rawgId, env).catch(() => null)
  ]);

  const seenTitles = new Set([norm(sourceName || base?.name || "")]);
  const unique = new Map();
  const addItems = (list) => {
    for (const game of list || []) {
      if (!game?.id || String(game.id) === rawgId) continue;
      const key = norm(game.name);
      if (!key || seenTitles.has(key)) continue;
      seenTitles.add(key);
      unique.set(game.id, game);
    }
  };

  addItems(seriesRes.results);
  addItems(suggestedRes.results);

  if (unique.size < 8 && base) {
    const developerIds = (base.developers || []).map(x => x.id).filter(Boolean).slice(0, 2);
    const genreIds = (base.genres || []).map(x => x.id).filter(Boolean).slice(0, 2);
    const tagIds = (base.tags || []).map(x => x.id).filter(Boolean).slice(0, 2);
    const queries = [];
    for (const dev of developerIds) {
      queries.push(rawg("/games", env, { developers: String(dev), page_size: "10", ordering: "-added" }).then(x => x.results || []).catch(() => []));
    }
    for (const gen of genreIds) {
      queries.push(rawg("/games", env, { genres: String(gen), page_size: "10", ordering: "-added" }).then(x => x.results || []).catch(() => []));
    }
    if (!developerIds.length && tagIds.length) {
      queries.push(rawg("/games", env, { tags: tagIds.join(","), page_size: "10", ordering: "-added" }).then(x => x.results || []).catch(() => []));
    }
    const groups = await Promise.all(queries);
    for (const group of groups) addItems(group);
  }

  return [...unique.values()].slice(0, 12).map(shape);
}

async function latestHits(env) {
  // Restrict to recent releases: popular evergreen titles cannot dominate this tab.
  const today = new Date();
  const end = dateOnly(today);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 365);
  const start = dateOnly(startDate);
  const data = await rawg("/games", env, {
    dates: `${start},${end}`,
    page_size: "40",
    ordering: "-added"
  });
  const items = (data.results || [])
    .filter(g => g.released && g.released >= start && g.released <= end)
    .sort((a, b) => activity(b) - activity(a))
    .slice(0, 14);
  return items.map(shape);
}

async function upcoming(env) {
  const start = dateOnly(new Date());
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 365);
  const end = dateOnly(endDate);
  const data = await rawg("/games", env, {
    dates: `${start},${end}`,
    page_size: "30",
    ordering: "-added"
  });
  return (data.results || [])
    .filter(g => g.released && g.released >= start && g.released <= end)
    .sort((a, b) => a.released.localeCompare(b.released))
    .slice(0, 14)
    .map(shape);
}

async function steamSearch(query) {
  const url = new URL("https://store.steampowered.com/api/storesearch/");
  url.searchParams.set("term", query);
  url.searchParams.set("l", "english");
  url.searchParams.set("cc", "US");
  const response = await fetch(url.toString(), {
    headers: { "User-Agent": "SavePoint/1.0" }
  });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data.items) ? data.items : [];
}

async function steamGame(item) {
  const url = new URL("https://store.steampowered.com/api/appdetails");
  url.searchParams.set("appids", String(item.id));
  url.searchParams.set("l", "english");
  const response = await fetch(url.toString(), {
    headers: { "User-Agent": "SavePoint/1.0" }
  });
  if (!response.ok) return {
    id: item.id, name: item.name, headerImage: item.tiny_image || ""
  };
  const payload = await response.json();
  const data = payload?.[String(item.id)]?.data;
  if (!data) return {
    id: item.id, name: item.name, headerImage: item.tiny_image || ""
  };

  const portrait = `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/library_600x900.jpg`;
  let portraitCover = "";
  try {
    const imageCheck = await fetch(portrait, { method: "HEAD" });
    if (imageCheck.ok && (imageCheck.headers.get("content-type") || "").startsWith("image/")) {
      portraitCover = portrait;
    }
  } catch {}

  return {
    id: item.id,
    name: data.name || item.name,
    headerImage: data.header_image || item.tiny_image || "",
    portraitCover,
    releaseDate: data.release_date?.date || "",
    genres: (data.genres || []).map(x => x.description),
    developers: data.developers || [],
    publishers: data.publishers || [],
    description: data.short_description || "",
    website: data.website || ""
  };
}

async function rawg(path, env, params = {}) {
  const u = new URL(BASE + path);
  u.searchParams.set("key", env.RAWG_API_KEY);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const response = await fetch(u.toString());
  if (!response.ok) throw new Error(`RAWG ${response.status}: ${(await response.text()).slice(0, 160)}`);
  return response.json();
}

async function cached(key, seconds, fn) {
  const old = cache.get(key);
  if (old && old.expires > Date.now()) return old.value;
  const value = await fn();
  cache.set(key, { value, expires: Date.now() + seconds * 1000 });
  if (cache.size > 250) cache.delete(cache.keys().next().value);
  return value;
}

function activity(g) {
  return (Number(g.added) || 0) * 1.5 + (Number(g.ratings_count) || 0) * 4 +
    (Number(g.metacritic) || 0) * 2 + (Number(g.rating) || 0) * 15;
}
function companyMatch(q, name) {
  const a = norm(q), b = norm(name);
  if (!a || !b) return false;

  // Only enter company search when the user's whole query is a company name.
  // Broad prefix/substring matching caused title searches such as
  // "Silver Pines" and "Persona 5: The Phantom X" to become false company searches.
  if (a === b) return true;

  // Allow a one-word brand query to match a longer legal/region variant,
  // e.g. "Atlus" -> "Atlus USA", without matching a multi-word game title.
  const corporateSuffixes = new Set([
    "usa", "inc", "incorporated", "co", "company", "corp", "corporation",
    "games", "game", "interactive", "entertainment", "studios", "studio"
  ]);
  const parts = b.split(" ");
  return a.split(" ").length === 1 &&
    a.length >= 4 &&
    parts[0] === a &&
    parts.slice(1).every(part => corporateSuffixes.has(part));
}
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
function clean(s) {
  return String(s || "").replace(/[\r\n;]/g, " ").trim().slice(0, 80);
}
function num(s) {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function dateOnly(d) {
  return d.toISOString().slice(0, 10);
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}
