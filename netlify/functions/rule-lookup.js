// netlify/functions/rule-lookup.js

exports.handler = async function (event) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  const rule = event.queryStringParameters?.rule;
  if (!rule) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "No rule slug provided" }) };
  }

  const candidates = [
    `https://tow.whfb.app/special-rules/${rule}`,
    `https://tow.whfb.app/rules/special-rules/${rule}`,
    `https://tow.whfb.app/rules/${rule}`,
  ];

  let html = null;
  let sourceUrl = null;

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html",
        },
      });
      if (res.ok) {
        html = await res.text();
        sourceUrl = url;
        break;
      }
    } catch (_) {}
  }

  if (!html) {
    return {
      statusCode: 404,
      headers: CORS,
      body: JSON.stringify({ error: "Rule not found", slug: rule }),
    };
  }

  const parsed = parseRulePage(html, sourceUrl, rule);
  return { statusCode: 200, headers: CORS, body: JSON.stringify(parsed) };
};

function parseRulePage(html, sourceUrl, slug) {
  const result = { sourceUrl };

  // Pretty rule name from slug as fallback
  const prettyName = slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  result.name = prettyName;

  // Try to get real rule name from h1 — but reject if it's the site title
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    const h1Text = stripTags(h1Match[1]).trim();
    if (h1Text.length > 2 && !h1Text.toLowerCase().includes("online rules index") && !h1Text.toLowerCase().includes("warhammer: the old world")) {
      result.name = h1Text;
    }
  }

  // Strip all tags to get a plain text version to work with
  const plainText = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join("\n");

  // The key pattern: tow.whfb.app always has "Rulebook, p. XXX · [rule text]"
  // OR the text appears right after the page reference line
  // Find "Rulebook, p. NNN" and grab everything after the · separator
  const rulebookMatch = plainText.match(/Rulebook,?\s*p\.\s*\d+\s*[·•]\s*([\s\S]+?)(?=\n(?:Back|Source:|Table of Contents|Last update|New FAQ|Special Rules Table|Cumulative)|$)/i);

  if (rulebookMatch) {
    const pageRefMatch = plainText.match(/Rulebook,?\s*p\.\s*\d+/i);
    if (pageRefMatch) result.pageRef = pageRefMatch[0];

    const bodyLines = rulebookMatch[1]
      .split("\n")
      .map(l => l.trim())
      .filter(l =>
        l.length > 10 &&
        !l.match(/^back$/i) &&
        !l.match(/^source:/i) &&
        !l.match(/^last update/i) &&
        !l.match(/^table of contents/i) &&
        !l.match(/online rules index/i) &&
        !l.match(/^new faq/i)
      );

    if (bodyLines.length) {
      result.body = bodyLines.join(" ").replace(/\s{2,}/g, " ").trim();
      return result;
    }
  }

  // Fallback: find the rule name in plain text, then grab the paragraph after it
  const nameIdx = plainText.indexOf(result.name);
  if (nameIdx !== -1) {
    const afterName = plainText.slice(nameIdx + result.name.length);
    // Skip page ref line, grab the meaty paragraph
    const paragraphs = afterName
      .split("\n")
      .map(l => l.trim())
      .filter(l =>
        l.length > 40 &&
        !l.match(/^back$/i) &&
        !l.match(/^source:/i) &&
        !l.match(/online rules index/i) &&
        !l.match(/table of contents/i) &&
        !l.match(/^last update/i)
      );

    if (paragraphs.length) {
      result.body = paragraphs[0];
    }
  }

  return result;
}

function stripTags(str) {
  return str
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
