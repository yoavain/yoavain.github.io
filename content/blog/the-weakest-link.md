---
title: "The Weakest Link"
subtitle: "A font compressor, an unhandled rejection, and the blast radius of a dependency"
description: >-
  Requiring one npm package silently changed how my Node.js server handled
  unhandled promise rejections. Here is how I found it, and what it says about
  the risk we accept every time we run npm install.
date: 2026-09-05
tags:
  - posts
  - nodejs
  - open-source
  - supply-chain
  - emscripten
  - debugging
image: /assets/images/the-weakest-link/cover.jpg
image_alt: >-
  A heavy iron chain lying on a scarred wooden workbench, one link snapped
  clean through, with tools and metal shavings out of focus behind it.
---

They say people are the weakest link in cybersecurity. If that is true, I would
nominate time as the second.

I can offer evidence. What follows happened in January 2022. I drafted it that
same week, and then did not publish it for nearly five years, because there was
always something with a deadline sitting in front of it. The post lost to the
exact shortage it is about.

Some of the details have aged. Node.js has since made unhandled rejections fatal
by default, which is to say that the behaviour I spend this post objecting to
is now the behaviour you get for free. What has not aged is how it was forced on me.

With unlimited time, I would write far more of my own code and lean on far fewer
third-party packages. For the packages I did adopt, I would read them end to end
before shipping them.

Nobody has unlimited time. So we cut corners. We install a lot of third-party
code, directly and transitively. We test it, of course: we check that it does
the job, sometimes that it is fast enough, occasionally we compare two or three
candidates before picking one.

And then we move on, and what we are left with is a black box.

We expect two things from that box:

1. That it does the job we installed it for.
2. That it stays out of the way when it is not doing that job. In other words,
   that it has no side effects.

We are reasonably good at testing the first expectation. We almost never test
the second. That asymmetry matters, because when a package misbehaves inside the
flow that uses it, the package is an obvious suspect. When it misbehaves
somewhere else entirely, you are in for a long day.

This is the story of one of those days.

## The setup

The system was a PERN stack: PostgreSQL, Express, React, Node.js. It was started
back when callbacks were still more popular than promises, before anyone on the
team had said the words `async`/`await` out loud, and before TypeScript was part
of our toolchain. It had been running in production for years. We considered it
boring, in the good way.

Then one afternoon I made a typo while calling a REST API on my local machine,
and the server process died. The log blamed an unhandled promise rejection.

That should not have happened. We were on Node.js 14, where an unhandled
rejection produces a warning, not a fatal error:

```
(node:26404) UnhandledPromiseRejectionWarning: This is an unhandled exception
(node:26404) [DEP0018] DeprecationWarning: Unhandled promise rejections are
deprecated. In the future, promise rejections that are not handled will
terminate the Node.js process with a non-zero exit code.
```

I knew that warning well. It was a problem for future me. Apparently future me
had arrived early.

## The dig

The stack trace pointed at a package that had nothing to do with the endpoint I
had just broken:

```
RuntimeError: abort(This is an unhandled exception).
    at process.abort (...\node_modules\wawoff2\build\compress_binding.js:1:10773)
    at process.emit (events.js:412:35)
    at processPromiseRejections (internal/process/promises.js:245:33)
    at processTicksAndRejections (internal/process/task_queues.js:96:32)
```

[`wawoff2`](https://www.npmjs.com/package/wawoff2) is a WOFF2 font compressor. It
was in the dependency tree, and it was required somewhere at startup, but it was
categorically not in use anywhere near my REST call. So what was in it that could
kill my server?

The file was minified. I reformatted it, went looking, and found this:

```js
process["on"]("unhandledRejection", function(reason) {
  throw reason;
});
```

Globals. You have to love them.

Node emits an [`unhandledRejection`](https://nodejs.org/api/process.html#event-unhandledrejection)
event whenever a promise is rejected with no handler attached within a turn of
the event loop. The event exists so that you can observe those rejections: log
them, count them, alert on them. The handler above does not observe anything. It
rethrows the rejection reason into the main flow as an uncaught exception, which
terminates the process.

Nothing about the package's documented job, compressing fonts, requires that.
Merely importing the module was enough to change a process-wide default for
every other line of code in the application.

Here is the whole thing in fifteen lines:

```js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const unhandledRejectionHere = async () => {
  Promise.reject("This is an unhandled rejection");
};

const main = async () => {
  await unhandledRejectionHere();
  await sleep(1000);
  console.log("Survived: before require");

  require("wawoff2");

  await unhandledRejectionHere();
  await sleep(1000);
  console.log("Survived: after require"); // never runs
};

main().catch(console.error);
```

The first rejection warns. The second one kills the process. The only difference
between them is an import.

## First stop: the co-worker

I went to the colleague who had added the package, and started bargaining:

1. Is this package already in active use in production?
2. When you added it, did you evaluate any alternatives that do the same job?
3. What would it take to run this code in a child process?

Question three is the honest fallback. If you cannot trust a dependency to leave
the process alone, put it in a process you are willing to lose. But it is a
workaround, and workarounds have a way of quietly becoming architecture.

## Second stop: upstream

With the low expectations that the open-source ecosystem has trained into all of
us, I opened the package's npm page. Eighteen thousand weekly downloads. A real
user base. Last published ten months earlier. Ouch.

(Those were the 2022 numbers. I checked again before finally publishing this:
it is now a little over 534,000 downloads a week.)

I checked the documentation for any hint that this was intentional. Nothing.

So on 19 January 2022, at 10:54 UTC, I opened
[an issue](https://github.com/fontello/wawoff2/issues/9) with a clear title, a
fifteen-line reproduction, the expected output, and the actual output.

Sixteen minutes later, the maintainer, [Vitaly Puzrin](https://github.com/puzrin),
replied. He explained that the offending code is generated by
[Emscripten](https://emscripten.org/), not written by hand, and offered three
hypotheses:

- It was already fixed upstream in Emscripten and only needed a rebuild.
- The build options were wrong or missing.
- It was an Emscripten bug and belonged in their tracker.

He was candid that he was busy and did not keep Emscripten's flags in his head,
and asked whether I had time to localise the problem, noting that the build was
containerised and, in his words, "as friction-less as possible."

Three minutes after that, a second reply, linking a related Emscripten issue
involving `uncaughtException` rather than `unhandledRejection`.

Two substantive replies in twenty minutes, on a package he had not touched in
ten months. That is commitment. Challenge accepted.

## Third stop: the build

Some searching turned up
[emscripten-core/emscripten#9061](https://github.com/emscripten-core/emscripten/pull/9061),
which had made the rejection handler opt-in behind a setting. My first read was
that a newer Emscripten would fix this for free. Vitaly had already pushed a
`dev` branch built with a newer version; I tested the artifacts, and the handler
was still there. The setting had to be turned off explicitly, not merely left
alone.

So I forked the repo, built it, adjusted the scripts from Linux to Windows, and
built again. Vitaly was right about the build being frictionless. He also passed
along a good debugging trick: drop `-s SINGLE_FILE=1` and add `-g2`, and the
generated wrappers come out unminified, so you can diff one build against the
next.

Two flags turned out to matter:

| Flag | Removes |
|---|---|
| `-s NODEJS_CATCH_REJECTION=0` | the `unhandledRejection` handler that rethrows |
| `-s NODEJS_CATCH_EXIT=0` | the matching `uncaughtException` handler |

A third candidate, `-s ENVIRONMENT=node`, produced tighter output by hardcoding
the environment checks:

```js
// before
var ENVIRONMENT_IS_WEB = typeof window === "object";
var ENVIRONMENT_IS_NODE = typeof process === "object" && /* ... */;

// after
var ENVIRONMENT_IS_WEB = false;
var ENVIRONMENT_IS_NODE = true;
```

That would have restricted the module to Node and broken it in browsers, so I
left it out. Fixing your own problem is not a licence to break someone else's.

The change came down to one line in `src/Makefile`:

```make
CARGS=--bind -s NODEJS_CATCH_REJECTION=0 -s NODEJS_CATCH_EXIT=0 -s ALLOW_MEMORY_GROWTH=1 -s SINGLE_FILE=1 -O3
```

I opened [a pull request](https://github.com/fontello/wawoff2/pull/10) at 16:03.
It was merged at 16:16. I thanked Vitaly and asked whether he could publish a
release, without which none of it would have reached anyone. He had already done
it. Version 2.0.1 went out at 16:24.

Issue opened to fixed version on npm: **five hours and twenty-nine minutes**.

That is still the newest release. Nothing has been published since, which means
every one of those half a million weekly downloads carries the fix.

## What I took away from it

The easy conclusion is "be careful with open source," which is advice nobody can
act on. Here is what I actually changed my mind about.

**A dependency's blast radius is not its API surface.** I had been reasoning
about packages in terms of the functions I call. But an import runs code, and
code at import time can reach anything process-global: signal handlers,
`process` listeners, prototypes, `Error.prepareStackTrace`, environment
variables. The API is the part you agreed to. The import is the part you got.

**"No side effects" is a property you test for, not assume.** We verify that a
package does its job. Almost nobody asserts that importing it changes nothing
else. That test is cheap. Snapshot the listener counts on `process` before and
after the import, and fail if they moved. It is the test that would have caught
this on day one instead of years in.

**Generated code deserves more suspicion, not less.** Nobody at Fontello wrote
that handler. Emscripten did, and its defaults shifted underneath a build that
had not been re-run in ten months. Compiled and transpiled artifacts carry their
build environment's opinions along with them. That covers wasm glue, bundled
binaries, and anything with a toolchain between the source and the
`node_modules` folder.

**Maintainer responsiveness is a selection criterion.** We compare packages on
downloads, bundle size, and benchmarks. The variable that decided this outcome
was that a busy maintainer answered in sixteen minutes and shipped the same
afternoon. You can estimate that before you adopt a package: open the issue
tracker, see how old the open issues are and how the closed ones ended.

**Report it upstream.** Vendoring a patch or shelling out to a child process
would have unblocked me in an afternoon and left eighteen thousand other weekly
downloads exposed. Filing the issue cost me one day and fixed it for everyone,
permanently. That trade is usually better than it looks from inside a sprint.

So: do not give up on open source. It took one afternoon, two flags, and a
maintainer who cared, and the fix is now in everyone's `node_modules`. That is
the system working exactly as intended.

Just remember that every install is a decision to run someone else's code in your
process, and that the chain is only as strong as its weakest link.

Vitaly went from a stranger's bug report to a published fix in five and a half
hours. I went from a finished draft to a published post in nearly five years.
People may be the weakest link. Time is right behind them, and it is undefeated.

---

*The full exchange is public: [fontello/wawoff2#9](https://github.com/fontello/wawoff2/issues/9).
Thanks to [Vitaly Puzrin](https://github.com/puzrin) for the fastest turnaround I
have ever had on a bug report.*
