// netlify/functions/rule-lookup.js
// Fetches special rule definitions from tow.whfb.app and returns parsed JSON.
// Called by GameView.jsx as: /.netlify/functions/rule-lookup?rule={slug}

exports.handler = async function (event) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  const rule = event.queryStringParameters?.rule;
  if (!rule) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "No rule slug provided" }) };
  }

  // Try candidate URL patterns in order
  const candidates = [
    `https://tow.whfb.app/rules/special-rules/${rule}`,
    `https://tow.whfb.app/special-rules/${rule}`,
    `https://tow.whfb.app/rules/${rule}`,
  ];

  let html = null;
  let sourceUrl = null;

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; TOW-Army-Builder/1.0)" },
      });
      if (res.ok) {
        html = await res.text();
        sourceUrl = url;
        break;
      }
    } catch (_) {
      // try next
    }
  }

  if (!html) {
    return {
      statusCode: 404,
      headers: CORS,
      body: JSON.stringify({ error: "Rule not found", slug: rule }),
    };
  }

  // ── Parse the HTML ──
  // tow.whfb.app uses a consistent structure:
  //   <h1> = rule name
  //   .breadcrumb or nav = breadcrumb text
  //   <em> inside main content = flavor text
  //   <p> tags = body text

  const parsed = parseRulePage(html, sourceUrl);

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify(parsed),
  };
};

function parseRulePage(html, sourceUrl) {
  const result = { sourceUrl };

  // Extract rule name from <h1>
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    result.name = stripTags(h1Match[1]).trim();
  }

  // Extract breadcrumb (e.g. "Special Rules :: Table of Contents")
  const breadcrumbMatch = html.match(/<(?:nav|div)[^>]*class="[^"]*breadcrumb[^"]*"[^>]*>([\s\S]*?)<\/(?:nav|div)>/i)
    || html.match(/Special Rules.*?Table of Contents/i);
  if (breadcrumbMatch) {
    result.breadcrumb = stripTags(breadcrumbMatch[0]).trim().replace(/\s+/g, " ");
  }

  // Extract meta info (Last update, page reference)
  // Look for patterns like "Last update: 2025 June 25" and "Rulebook, p. 178"
  const metaPatterns = [
    /Last update[^<\n]*/i,
    /Rulebook[^<\n]*/i,
    /Errata[^<\n]*/i,
  ];
  const metas = [];
  for (const pat of metaPatterns) {
    const m = html.match(pat);
    if (m) metas.push(m[0].trim());
  }
  if (metas.length) result.meta = metas.join("\n");

  // Extract main content area — look for <main> or <article> or the primary content div
  let contentHtml = html;
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    || html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (mainMatch) contentHtml = mainMatch[1];

  // Extract italic flavor text (typically <em> or <i> in a <p>)
  const flavorMatch = contentHtml.match(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/i);
  if (flavorMatch) {
    const flavor = stripTags(flavorMatch[1]).trim();
    if (flavor.length > 20) result.flavorText = flavor;
  }

  // Extract body paragraphs — all <p> tags after the h1
  const afterH1 = contentHtml.replace(/<h1[\s\S]*?<\/h1>/i, "");
  const paragraphs = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = pRegex.exec(afterH1)) !== null) {
    const text = stripTags(match[1]).trim();
    // Skip very short texts, navigation items, and the flavor text we already captured
    if (text.length > 30 && text !== result.flavorText) {
      paragraphs.push(text);
    }
  }
  if (paragraphs.length) result.body = paragraphs.join("\n\n");

  return result;
}

function stripTags(str) {
  return str
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
