// Netlify Function: fetches the Mortgage News Daily rate index and returns JSON.
// URL once deployed:  https://YOUR-SITE.netlify.app/.netlify/functions/mnd-rates
// Debug view:         https://YOUR-SITE.netlify.app/.netlify/functions/mnd-rates?debug

const SOURCE_URL = "https://www.mortgagenewsdaily.com/mortgage-rates/mnd";

// Case-sensitive labels from the MND rate table.
// (The site menu uses things like "30 YR FHA" in caps; case-sensitive matching skips those.)
const LABELS = {
  "30yr": "30 Yr. Fixed",
  "15yr": "15 Yr. Fixed",
  fha: "30 Yr. FHA",
  va: "30 Yr. VA",
  jumbo: "30 Yr. Jumbo",
};

const CACHE_MS = 60 * 60 * 1000; // ~1 hour
let memoryCache = null; // survives between calls while the function stays warm

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function snippetsFor(text, label, max = 6, pad = 90) {
  const out = [];
  let i = text.indexOf(label);
  while (i !== -1 && out.length < max) {
    out.push("…" + text.slice(Math.max(0, i - pad), i + label.length + pad) + "…");
    i = text.indexOf(label, i + label.length);
  }
  return out.length ? out : ["(label not found on page)"];
}

function json(body, status = 200, cacheHeaders = true) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  };
  if (cacheHeaders) {
    headers["Cache-Control"] = "public, max-age=0, must-revalidate";
    headers["Netlify-CDN-Cache-Control"] = "public, durable, s-maxage=3600, stale-while-revalidate=600";
  } else {
    headers["Cache-Control"] = "no-store";
  }
  return new Response(JSON.stringify(body, null, 2), { status, headers });
}

export default async (req) => {
  const debug = new URL(req.url).searchParams.has("debug");

  if (!debug && memoryCache && Date.now() - memoryCache.time < CACHE_MS) {
    return json({ ...memoryCache.data, cached: true });
  }

  try {
    const res = await fetch(SOURCE_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`Mortgage News Daily returned HTTP ${res.status}`);

    const text = htmlToText(await res.text());

    const rates = {};
    const missing = [];
    for (const [key, label] of Object.entries(LABELS)) {
      // Label, optional spaces, then a rate like 7.33%. No "i" flag = case-sensitive.
      const m = text.match(new RegExp(escapeRe(label) + "\\s*(\\d{1,2}\\.\\d{1,3})\\s*%"));
      const val = m ? parseFloat(m[1]) : NaN;
      if (val > 1 && val < 20) rates[key] = val;
      else missing.push(key);
    }

    const dateMatch = text.match(/Last Updated:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);

    const data = {
      ok: Object.keys(rates).length > 0,
      source: "Mortgage News Daily",
      sourceUrl: SOURCE_URL,
      asOf: dateMatch ? dateMatch[1] : null,
      rates,
      missing,
      fetchedAt: new Date().toISOString(),
    };

    if (debug) {
      const snippets = {};
      for (const [key, label] of Object.entries(LABELS)) snippets[`${key} — "${label}"`] = snippetsFor(text, label);
      snippets['date — "Last Updated:"'] = snippetsFor(text, "Last Updated:");
      return json({ ...data, debug: { pageTextLength: text.length, snippets } }, 200, false);
    }

    if (!data.ok) throw new Error("Page loaded, but no rates matched. Open ?debug to see why.");

    memoryCache = { time: Date.now(), data };
    return json(data);
  } catch (err) {
    if (memoryCache) return json({ ...memoryCache.data, stale: true, error: String(err.message || err) });
    return json({ ok: false, error: String(err.message || err) }, 502, false);
  }
};

