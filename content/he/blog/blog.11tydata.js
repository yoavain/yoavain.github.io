export default {
  layout: "layouts/post.njk",
  tags: ["posts"],
  lang: "he",
  // /he/blog/<slug>/ for a post in Hebrew. A post in English stays at /blog/<slug>/.
  permalink: "/he/blog/{{ page.fileSlug }}/",
};
