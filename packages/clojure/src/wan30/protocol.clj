(ns wan30.protocol
  {:no-doc true}
  (:require [clojure.data.json :as json]
            [clojure.string :as str]
            [wan30.errors :as errors]
            [wan30.validate :as validate])
  (:import [java.nio.charset Charset CodingErrorAction StandardCharsets]))

(def latest-protocol-version "2025-11-25")

(def supported-protocol-versions
  [latest-protocol-version "2025-06-18" "2025-03-26" "2024-11-05" "2024-10-07"])

(def client-info-name "wan30-clj")
(def initialize-timeout 60)
(def tool-timeout 300)
(def response-limit 2097152)
(def auth-response-limit 65536)

(defn- decode-utf8 [^bytes payload]
  (let [decoder (.. (Charset/forName "UTF-8")
                    (newDecoder)
                    (onMalformedInput CodingErrorAction/REPORT)
                    (onUnmappableCharacter CodingErrorAction/REPORT))]
    (try
      (.toString (.decode decoder (java.nio.ByteBuffer/wrap payload)))
      (catch Exception _
        (errors/fail "INVALID_RESPONSE" "The server returned an unreadable response.")))))

(defn- read-json [^bytes payload]
  (try
    (json/read-str (decode-utf8 payload) :key-fn keyword)
    (catch clojure.lang.ExceptionInfo error
      (if (= "INVALID_RESPONSE" (:code (ex-data error)))
        (throw error)
        (errors/fail "INVALID_RESPONSE" "The server returned an unreadable response.")))
    (catch Exception _
      (errors/fail "INVALID_RESPONSE" "The server returned an unreadable response."))))

(defn- write-json [value]
  (.getBytes (json/write-str value) StandardCharsets/UTF_8))

(defn header [headers name]
  (let [lower (str/lower-case name)]
    (some (fn [[key value]]
            (when (= (str/lower-case (str key)) lower)
              value))
          headers)))

(defn media-type [value]
  (when value
    (-> value (str/split #";" 2) first str/trim str/lower-case)))

(defn- flush-event [messages data-lines event-name]
  (if (and (seq data-lines) (or (str/blank? event-name) (= event-name "message")))
    (conj messages (try
                     (json/read-str (str/join "\n" data-lines) :key-fn keyword)
                     (catch Exception _
                       (errors/fail "INVALID_RESPONSE"
                                    "The server returned an unreadable response."))))
    messages))

(defn parse-sse [^bytes payload]
  (let [text (-> (decode-utf8 payload)
                 (str/replace #"\r\n" "\n")
                 (str/replace #"\r" "\n"))]
    (loop [lines (str/split text #"\n" -1)
           messages []
           data-lines []
           event-name nil]
      (if (empty? lines)
        (flush-event messages data-lines event-name)
        (let [line (first lines)]
          (cond
            (str/blank? line)
            (recur (rest lines)
                   (flush-event messages data-lines event-name)
                   []
                   nil)

            (str/starts-with? line ":")
            (recur (rest lines) messages data-lines event-name)

            :else
            (let [split-at (.indexOf line ":")
                  field (if (neg? split-at) line (subs line 0 split-at))
                  raw (if (neg? split-at) "" (subs line (inc split-at)))
                  value (if (str/starts-with? raw " ") (subs raw 1) raw)]
              (cond
                (= field "data")
                (recur (rest lines) messages (conj data-lines value) event-name)
                (= field "event")
                (recur (rest lines) messages data-lines value)
                :else
                (recur (rest lines) messages data-lines event-name)))))))))

(defn rpc-messages [{:keys [headers body]}]
  (case (media-type (header headers "content-type"))
    "text/event-stream" (parse-sse body)
    "application/json"
    (let [data (read-json body)]
      (cond
        (vector? data) data
        (map? data) [data]
        :else (errors/fail "INVALID_RESPONSE" "The server returned an unreadable response.")))
    (errors/fail "INVALID_RESPONSE" "The server returned an unreadable response.")))

(defn- session-header [headers]
  (let [raw (header headers "mcp-session-id")]
    (cond
      (or (nil? raw) (= raw "")) nil
      (and (string? raw)
           (every? (fn [ch]
                     (let [code (int ch)]
                       (<= 0x21 code 0x7E)))
                   raw))
      raw
      :else (errors/fail "INVALID_RESPONSE" "The server returned an unreadable response."))))

(defn- matching [messages id]
  (or (some (fn [message]
              (when (and (map? message)
                         (contains? message :id)
                         (integer? (:id message))
                         (= (:id message) id))
                message))
            messages)
      (errors/fail "INVALID_RESPONSE" "The server returned an unreadable response.")))

(defn- raise-rpc [message]
  (let [error (:error message)]
    (when-not (map? error)
      (errors/fail "INVALID_RESPONSE" "The server returned an unreadable response."))
    (let [rpc-code (:code error)
          text (if (and (string? (:message error)) (seq (:message error)))
                 (:message error)
                 "Tool call failed.")]
      (if (= rpc-code 401)
        (errors/fail "AUTH_REQUIRED" errors/auth-required-message 401)
        (errors/fail "PROTOCOL_ERROR" (str "MCP error " rpc-code ": " text) nil rpc-code)))))

(defn- reset-session [client]
  (reset! (:session client) {:session-id nil
                             :protocol-version nil
                             :next-id 0
                             :ready false}))

(defn- post [client payload timeout max-bytes]
  (let [token (:token client)]
    (when-not (and (string? token) (seq token))
      (errors/fail "INVALID_TOKEN"
                   "Access token is not a Wan30 API authorization. Sign in again."))
    (let [url (validate/assert-destination (str (:origin client) "/api/mcp/") (:origin client))
          state @(:session client)
          headers (cond-> {"Authorization" (str "Bearer " token)
                           "Content-Type" "application/json"
                           "Accept" "application/json, text/event-stream"}
                    (:session-id state) (assoc "mcp-session-id" (:session-id state))
                    (:protocol-version state) (assoc "mcp-protocol-version" (:protocol-version state)))
          response (try
                     ((:request client) {:method "POST"
                                         :url url
                                         :headers headers
                                         :body (write-json payload)
                                         :timeout-seconds timeout
                                         :max-bytes max-bytes})
                     (catch clojure.lang.ExceptionInfo error
                       (throw error))
                     (catch Exception _
                       (errors/fail "PROTOCOL_ERROR" "The server response was lost.")))]
      (when (= 401 (:status response))
        (reset-session client)
        (errors/fail "AUTH_REQUIRED" errors/auth-required-message 401))
      (when-let [session (session-header (:headers response))]
        (swap! (:session client) assoc :session-id session))
      response)))

(defn- request-rpc [client method params timeout]
  (let [id (:next-id (swap! (:session client) update :next-id inc))
        id (dec id)
        response (post client {:method method
                               :params params
                               :jsonrpc "2.0"
                               :id id}
                       timeout
                       response-limit)]
    (when (or (= 202 (:status response))
              (< (:status response) 200)
              (>= (:status response) 300))
      (errors/fail "INVALID_RESPONSE"
                   (str "The server returned HTTP " (:status response) ".")
                   (:status response)))
    (let [message (matching (rpc-messages response) id)]
      (when (:error message)
        (raise-rpc message))
      (when-not (map? (:result message))
        (errors/fail "INVALID_RESPONSE" "The server returned an unreadable response."))
      (:result message))))

(defn- notify [client method timeout]
  (let [response (post client {:method method :jsonrpc "2.0"} timeout response-limit)]
    (when-not (#{200 202 204} (:status response))
      (errors/fail "INVALID_RESPONSE"
                   (str "The server returned HTTP " (:status response) ".")
                   (:status response)))))

(defn- ensure-ready [client]
  (when-not (:ready @(:session client))
    (try
      (let [result (request-rpc client "initialize"
                                {:protocolVersion latest-protocol-version
                                 :capabilities {}
                                 :clientInfo {:name client-info-name
                                              :version "0.1.0"}}
                                initialize-timeout)
            server-version (when (and (map? result) (string? (:protocolVersion result)))
                             (:protocolVersion result))]
        (when-not (some #{server-version} supported-protocol-versions)
          (errors/fail "PROTOCOL_ERROR"
                       (str "Server's protocol version is not supported: " server-version)))
        (swap! (:session client) assoc :protocol-version server-version)
        (notify client "notifications/initialized" initialize-timeout)
        (swap! (:session client) assoc :ready true))
      (catch Exception error
        (reset-session client)
        (throw error)))))

(defn call-tool [client name arguments]
  (locking (:lock client)
    (ensure-ready client)
    (request-rpc client "tools/call" {:name name :arguments arguments} tool-timeout)))

(defn disconnect [client]
  (let [url (validate/assert-destination (str (:origin client) "/api/mcp/disconnect/")
                                         (:origin client))
        token (:token client)]
    (when-not (and (string? token) (seq token))
      (errors/fail "INVALID_TOKEN"
                   "Access token is not a Wan30 API authorization. Sign in again."))
    (let [response (try
                     ((:request client) {:method "POST"
                                         :url url
                                         :headers {"Authorization" (str "Bearer " token)}
                                         :body (byte-array 0)
                                         :timeout-seconds initialize-timeout
                                         :max-bytes auth-response-limit})
                     (catch clojure.lang.ExceptionInfo error
                       (throw error))
                     (catch Exception _
                       (errors/fail "REVOCATION_UNCONFIRMED" "Could not disconnect.")))]
      (when-not (<= 200 (:status response) 299)
        (errors/fail "REVOCATION_UNCONFIRMED" "Could not disconnect." (:status response))))))

(defn close [client]
  (locking (:lock client)
    (reset-session client)))
