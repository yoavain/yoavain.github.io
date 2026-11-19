import { feedPlugin } from "@11ty/eleventy-plugin-rss";
import pluginSyntaxHighlight from "@11ty/eleventy-plugin-syntaxhighlight";

/** @param {import("@11ty/eleventy").UserConfig} eleventyConfig */
export default async function (eleventyConfig) {
  // Static assets. `css/` is kept at the top level so it is easy to find;
  // anything in `public/` lands at the site root (favicons, images, CNAME...).
  eleventyConfig.addPassthroughCopy({ "css/": "/css/" });
  eleventyConfig.addPassthroughCopy({ "public/": "/" });

  eleventyConfig.addWatchTarget("css/**/*.css");

  // Fenced code blocks are highlighted at build time. No JS is shipped to the
  // browser. Token colours are CSS variables, so they follow the theme.
  eleventyConfig.addPlugin(pluginSyntaxHighlight, {
    preAttributes: { tabindex: 0 },
  });

  eleventyConfig.addPlugin(feedPlugin, {
    type: "atom",
    outputPath: "/feed.xml",
    collection: { name: "posts", limit: 20 },
    metadata: {
      language: "en",
      title: "Yoav Vainrich",
      subtitle: "Notes on Node.js, dependencies, and things that broke.",
      base: "https://yoavain.github.io/",
      author: { name: "Yoav Vainrich" },
    },
  });

  // 5 September 2026
  eleventyConfig.addFilter("readableDate", (value) =>
    new Date(value).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }),
  );

  // 2026-09-05, for <time datetime="...">
  eleventyConfig.addFilter("htmlDateString", (value) =>
    new Date(value).toISOString().slice(0, 10),
  );

  // Note: the `absoluteUrl` filter used in the layouts comes from
  // eleventy-plugin-rss above. It takes the base as an argument:
  // `{{ page.url | absoluteUrl(metadata.url) }}`. Plugins are applied after
  // this config function returns, so defining a same-named filter here would
  // be silently overwritten by the plugin's.

  eleventyConfig.addFilter("readingTime", (content) => {
    const words = String(content).split(/\s+/g).filter(Boolean).length;
    return Math.max(1, Math.round(words / 220));
  });

  // Section headings. `tocItems` lists the h2 headings of a rendered post for the
  // table of contents. `headingIds` gives each h2 an id, so the list can link to it.
  // The two filters share one function, so their ids always agree. No dependency.
  const decode = (s) =>
    s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");
  const slugOf = (text) =>
    text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "-").replace(/^-+|-+$/g, "");
  const headings = (html) => {
    const seen = new Map();
    const items = [];
    const out = String(html).replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (match, attrs, inner) => {
      const text = decode(inner.replace(/<[^>]+>/g, "")).trim();
      const base = slugOf(text) || "section";
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      const id = n === 1 ? base : `${base}-${n}`;
      items.push({ id, text });
      return /\sid=/.test(attrs) ? match : `<h2${attrs} id="${id}">${inner}</h2>`;
    });
    return { html: out, items };
  };
  eleventyConfig.addFilter("tocItems", (html) => headings(html).items);
  eleventyConfig.addFilter("headingIds", (html) => headings(html).html);

  return {
    dir: {
      input: "content",
      includes: "../_includes",
      data: "../_data",
      output: "_site",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
