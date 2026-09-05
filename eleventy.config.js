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
