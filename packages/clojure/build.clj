(ns build
  (:require [clojure.tools.build.api :as b]
            [clojure.string :as str]))

(def lib 'io.github.notusinggithub/wan30-clj)
(def version "0.1.0")
(def class-dir "target/classes")
(def basis (delay (b/create-basis {:project "deps.edn"})))
(def jar-file (format "target/%s-%s.jar" (name lib) version))

(defn clean [_]
  (b/delete {:path "target"}))

(defn- git-sha []
  (str/trim (b/git-process {:git-args "rev-parse HEAD"})))

(defn jar [_]
  (clean nil)
  (b/copy-dir {:src-dirs ["src"] :target-dir class-dir})
  (b/write-pom {:class-dir class-dir
                :lib lib
                :version version
                :basis @basis
                :src-dirs ["src"]
                :scm {:url "https://github.com/NotUsingGithub/wan30-mcp"
                      :connection "scm:git:https://github.com/NotUsingGithub/wan30-mcp.git"
                      :developerConnection "scm:git:ssh://git@github.com/NotUsingGithub/wan30-mcp.git"
                      :tag (git-sha)}
                :pom-data [[:description "Clojure client for a wan30.video account. Purchased credits are required for generation."]
                           [:url "https://wan30.video/"]
                           [:licenses
                            [:license
                             [:name "MIT License"]
                             [:url "https://opensource.org/licenses/MIT"]
                             [:distribution "repo"]]]
                           [:developers
                            [:developer
                             [:name "Wan30"]
                             [:url "https://wan30.video/"]]
                            [:developer
                             [:name "NotUsingGithub"]
                             [:url "https://github.com/NotUsingGithub"]]]]})
  (b/jar {:class-dir class-dir :jar-file jar-file})
  (println "Wrote" jar-file "scm tag" (git-sha)))
