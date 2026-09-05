export default {
  layout: "layouts/post.njk",
  tags: ["posts"],
  // /blog/the-weakest-link/ rather than /blog/2026-09-05-the-weakest-link/
  permalink: "/blog/{{ page.fileSlug }}/",
};
