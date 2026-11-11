(ns wan30.validate
  {:no-doc true}
  (:require [clojure.string :as str]
            [wan30.errors :as errors])
  (:import [java.net URI]))

(def model-ids
  #{"wan30-reference-to-video"
    "wan30-text-to-video"
    "wan30-image-to-video"})

(def resolutions #{"480p" "720p" "1080p"})

(def aspect-ratios #{"16:9" "9:16" "1:1" "4:3" "3:4"})

(def reference-keys
  #{:prompt :durationSeconds :resolution :aspectRatio :hasAudio :modelId :imageUrls})

(def text-keys (disj reference-keys :imageUrls))

(def request-id-re #"^[A-Za-z0-9_-]{16,128}$")

(defn- keyword-key [key]
  (cond
    (keyword? key) key
    (string? key) (keyword key)
    :else key))

(defn keyword-keys
  "Copy a JSON object to keywords without adding or renaming fields."
  [value]
  (cond
    (map? value)
    (into {} (map (fn [[key item]]
                    [(keyword-key key) (keyword-keys item)]))
          value)
    (vector? value) (mapv keyword-keys value)
    :else value))

(defn utf16-length [value]
  (.length ^String value))

(defn- require-integer [value label low high]
  (when-not (and (integer? value) (not (boolean? value))
                 (<= low value high))
    (errors/fail "INVALID_INPUT"
                 (str label " must be an integer from " low " to " high "."))))

(defn normalize-origin [value]
  (when-not (string? value)
    (errors/fail "INVALID_ORIGIN" errors/origin-message))
  (let [uri (try (URI. value)
                 (catch Exception _
                   (errors/fail "INVALID_ORIGIN" errors/origin-message)))
        port (.getPort uri)
        host (.getHost uri)
        rebuilt (when host
                  (if (or (neg? port) (= port 443))
                    (str "https://" host)
                    (str "https://" host ":" port)))]
    (when (or (not= "https" (.getScheme uri))
              (not host)
              (.getUserInfo uri)
              (seq (.getRawPath uri))
              (.getRawQuery uri)
              (.getRawFragment uri)
              (not= rebuilt value))
      (errors/fail "INVALID_ORIGIN" errors/origin-message))
    value))

(defn origin-of [url]
  (try
    (let [uri (URI. url)
          port (.getPort uri)
          host (.getHost uri)]
      (when (and (= "https" (.getScheme uri)) host (not (.getUserInfo uri)))
        (if (or (neg? port) (= port 443))
          (str "https://" host)
          (str "https://" host ":" port))))
    (catch Exception _
      nil)))

(defn assert-destination [url origin]
  (when-not (= (origin-of url) origin)
    (errors/fail "INVALID_ORIGIN" "Unexpected authorization destination."))
  url)

(defn- https-url? [url]
  (and (string? url)
       (not (some #(str/includes? url %) [" " "\t" "\r" "\n"]))
       (try
         (let [uri (URI. url)]
           (and (= "https" (.getScheme uri))
                (.getHost uri)
                (not (.getUserInfo uri))))
         (catch Exception _
           false))))

(defn- validate-image-urls [urls low high]
  (when-not (and (sequential? urls) (not (string? urls)) (<= low (count urls) high))
    (errors/fail "INVALID_INPUT"
                 (str "imageUrls must contain " low " to " high " HTTPS URLs.")))
  (doseq [url urls]
    (when-not (https-url? url)
      (errors/fail "INVALID_INPUT" "imageUrls entries must be HTTPS URLs."))))

(defn- common [value allowed]
  (let [extra (->> (keys value)
                   (remove allowed)
                   (map name)
                   sort)]
    (when (seq extra)
      (errors/fail "INVALID_INPUT"
                   (str "Unexpected generation field: " (str/join ", " extra) "."))))
  (let [prompt (:prompt value)]
    (when-not (and (string? prompt) (<= 1 (utf16-length prompt) 1500))
      (errors/fail "INVALID_INPUT" "prompt must be 1 to 1500 characters.")))
  (when (contains? value :durationSeconds)
    (require-integer (:durationSeconds value) "durationSeconds" 2 30))
  (when (and (contains? value :resolution)
             (not (resolutions (:resolution value))))
    (errors/fail "INVALID_INPUT" "resolution must be 480p, 720p or 1080p."))
  (when (and (contains? value :aspectRatio)
             (not (aspect-ratios (:aspectRatio value))))
    (errors/fail "INVALID_INPUT" "aspectRatio must be 16:9, 9:16, 1:1, 4:3 or 3:4."))
  (when (and (contains? value :hasAudio)
             (not (boolean? (:hasAudio value))))
    (errors/fail "INVALID_INPUT" "hasAudio must be a boolean.")))

(defn validate-generation [value]
  (let [value (keyword-keys value)]
    (when-not (map? value)
      (errors/fail "INVALID_INPUT" "Generation input must be an object."))
    (let [model-id (get value :modelId "wan30-reference-to-video")]
      (when-not (model-ids model-id)
        (errors/fail "INVALID_INPUT" "modelId must be a supported Wan30 video model."))
      (cond
        (= model-id "wan30-text-to-video")
        (do
          (when-not (contains? value :modelId)
            (errors/fail "INVALID_INPUT" "modelId is required."))
          (common value text-keys))

        (= model-id "wan30-image-to-video")
        (do
          (when-not (contains? value :modelId)
            (errors/fail "INVALID_INPUT" "modelId is required."))
          (common value reference-keys)
          (validate-image-urls (:imageUrls value) 1 1))

        :else
        (do
          (common value reference-keys)
          (validate-image-urls (:imageUrls value) 1 10))))
    value))

(defn validate-request-id [request-id]
  (when-not (and (string? request-id) (re-matches request-id-re request-id))
    (errors/fail "INVALID_INPUT" "requestId must match ^[A-Za-z0-9_-]{16,128}$."))
  request-id)

(defn validate-model-id [model-id]
  (when-not (model-ids model-id)
    (errors/fail "INVALID_INPUT" "modelId must be a supported Wan30 video model."))
  model-id)

(defn validate-task-id [task-id]
  (when-not (and (string? task-id) (<= 1 (utf16-length task-id) 128))
    (errors/fail "INVALID_INPUT" "taskId must be 1 to 128 characters."))
  task-id)

(defn validate-limit [limit]
  (when (some? limit)
    (require-integer limit "limit" 1 50))
  limit)
