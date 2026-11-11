# wan30-clj

Clojure client for a [wan30.video](https://wan30.video/) account. It speaks the
same Streamable HTTP MCP endpoint as `@wan30/cli` 0.1.0: `POST {origin}/api/mcp/`.

Purchased wan30.video credits are required for generation. Sign-up, check-in
and gift credits alone do not qualify. `estimate` does not spend credits.
`generate` does not call the service unless `:confirm-spend` is exactly
`true`, and that flag is not sent. Pass the same `:request-id` on a retry.

This is not an official Alibaba, DashScope, or Tongyi client. It does not
depend on the Python package, which is not on PyPI yet.

```clojure
(require '[wan30.client :as wan30])

(def wan (wan30/client))
(def input {:modelId "wan30-text-to-video"
            :prompt "A paper boat on a rainy street"})

(wan30/estimate wan input)
(wan30/generate wan input {:request-id "paper-boat-request01"
                           :confirm-spend true})
```

`client` reads `WAN30_ACCESS_TOKEN` and, when `:origin` is omitted,
`WAN30_ORIGIN` from the process environment. It does not read `.env` files
or a credential store. Sign in with the existing Wan30 CLI, then export the
token into the process. You can also pass `:token` and an injected `:request`
function. The default request uses `java.net.http.HttpClient` and does not
follow redirects.

`disconnect` posts an empty body to `{origin}/api/mcp/disconnect/` with only
the bearer token. HTTP 401 from that call is `REVOCATION_UNCONFIRMED`.
`close` only drops the local session.

Models are `wan30-reference-to-video`, `wan30-text-to-video`, and
`wan30-image-to-video`. Omitted optional fields are not filled in.

## Coordinates

Checked on 2026-11-11, without logging in:

- Wan27 is published as `io.github.notusinggithub/wan27-clj` `0.1.0`.
  Its POM SCM url is `https://github.com/NotUsingGithub/wan27-clj` and its
  tag is `v0.1.0`. That repository is dedicated to the Clojure library.
- The Clojars user `notusinggithub` already has the verified group
  `io.github.notusinggithub`. New libraries must use a verified group.
- Clojars search for `wan30` returned no results.
  `https://clojars.org/io.github.notusinggithub/wan30-clj` and
  `https://clojars.org/io.github.notusinggithub/wan30` both returned 404.
  The Maven metadata keys for both artifacts were `NoSuchKey`.

This library therefore uses the free coordinate:

```clojure
io.github.notusinggithub/wan30-clj {:mvn/version "0.1.0"}
```

## Clojars and cljdoc

Clojars publishes a JAR and a POM. It does not register a git subdirectory.
A library that lives in a monorepo can be deployed by uploading the JAR built
from that directory. No second repository is required for the upload itself.

cljdoc discovers new Clojars releases on its own: it asks Clojars about every
60 seconds and queues new releases about every 10 minutes. Nobody has to submit
this repository to cljdoc. A build still requires the JAR to be on Clojars,
which this pull request does not do.

cljdoc reads API documentation from the JAR. Docstrings in `wan30.client` are
the API text. It reads articles and source links from git, using the POM
`<scm><url>` and `<scm><tag>`. If `<tag>` is missing, it looks for a git tag
named `0.1.0` and then `v0.1.0`.

`tools.build` writes `<tag>` from `git rev-parse HEAD` when the JAR is built.
The url and connection are the real repository
`https://github.com/NotUsingGithub/wan30-mcp`. They are not a
`wan30-clj` repository, because that repository does not exist. This monorepo
had no git tags when this package was added.

The library is in `packages/clojure`, not at the git root. The cljdoc author
guide says a library outside the git root should set Leiningen's `:scm :dir`.
`tools.build` `:scm` has no `:dir` key. Putting `packages/clojure` into the
GitHub URL would not be a clone URL, and cljdoc strips extra GitHub path
segments when it resolves a repository. The POM therefore points at the
repository root and the exact commit. cljdoc can show the namespaces from the
JAR. It will read `README` and `doc/cljdoc.edn` from the repository root at
that commit, which is the JavaScript CLI, not this directory.

`doc/cljdoc.edn` in this directory is the article map for a checkout whose
root is this package. It is not added to the monorepo root.

## Later release

Do not deploy from this pull request. The Clojars user `notusinggithub`
already exists; do not create an account or a deploy token here.

1. Push the commit that contains `packages/clojure`.
2. From this directory, on that commit, run `clojure -T:build jar`.
   The POM `<tag>` becomes that commit's SHA. Rebuild after any later commit.
3. Create a Clojars deploy token in the existing account. The password used
   for deploy is that token.
4. Upload only `target/wan30-clj-0.1.0.jar` and the POM inside it at
   `META-INF/maven/io/github/notusinggithub/wan30-clj/pom.xml`.
   `deps-deploy` can do that with `:installer :remote` and
   `:sign-releases? false` unless a GPG key is already configured.
5. Leave cljdoc to notice the release. Do not request a build for this pull
   request. API pages can render from the JAR. The library README appears as
   the article when the released sources are the root of the git revision
   cljdoc checks out. That is how `wan27-clj` is published. It is not true of
   a tag on this monorepo unless a root `doc/cljdoc.edn` is added later.

Do not commit an access token.
