(ns wan30.client
  "Clojure client for a [wan30.video](https://wan30.video/) account.

  The client speaks the same Streamable HTTP MCP endpoint as `@wan30/cli`
  0.1.0: `POST {origin}/api/mcp/`. This is not an official Alibaba, DashScope,
  or Tongyi client.

  Purchased wan30.video credits are required for generation. Sign-up, check-in
  and gift credits alone do not qualify. [[estimate]] does not spend credits.
  [[generate]] does not call the service unless `:confirm-spend` is exactly
  `true`, and that flag is not sent. Pass the same `:request-id` on a retry.

  `client` reads `WAN30_ACCESS_TOKEN` and optional `WAN30_ORIGIN` only when
  the corresponding argument is omitted. It does not read `.env` files or a
  credential store."
  (:require [clojure.data.json :as json]
            [wan30.errors :as errors]
            [wan30.http :as http]
            [wan30.protocol :as protocol]
            [wan30.validate :as validate])
  (:import [java.util UUID]))

(defrecord Client [origin token request session lock])

(defn client
  "Return a client.

  `:token` is the bearer token. When omitted, `WAN30_ACCESS_TOKEN` is read
  from the process environment. `:origin` defaults to `https://wan30.video`,
  or to `WAN30_ORIGIN` when the caller does not pass one. `:request`, when
  supplied, replaces the HTTP exchange and is used by tests. `:env` replaces
  process-environment lookup and is also for tests."
  ([] (client {}))
  ([{:keys [token origin request env]
     :or {env #(System/getenv %)}}]
   (let [token (or token (env "WAN30_ACCESS_TOKEN"))]
     (when-not (and (string? token) (pos? (count token)))
       (errors/fail "INVALID_TOKEN"
                    "Access token is not a Wan30 API authorization. Sign in again."))
     (map->Client
      {:origin (validate/normalize-origin (or origin (env "WAN30_ORIGIN") "https://wan30.video"))
       :token token
       :request (or request http/exchange)
       :session (atom {:session-id nil
                       :protocol-version nil
                       :next-id 0
                       :ready false})
       :lock (Object.)}))))

(defn- tool-error [result]
  (let [text (let [entry (first (:content result))]
               (when (and (map? entry) (string? (:text entry)))
                 (:text entry)))
        parsed (try
                 (when text (json/read-str text :key-fn keyword))
                 (catch Exception _ nil))
        code (if (and (map? parsed) (string? (:code parsed)) (seq (:code parsed)))
               (:code parsed)
               "TOOL_ERROR")
        message (cond
                  (and (map? parsed) (string? (:message parsed)) (seq (:message parsed)))
                  (:message parsed)
                  (seq text) text
                  :else "Tool call failed.")]
    (errors/fail code message)))

(defn- call [client tool-name arguments]
  (let [result (protocol/call-tool client tool-name arguments)]
    (when (true? (:isError result))
      (tool-error result))
    (let [structured (:structuredContent result)]
      (if (and (map? structured) (contains? structured :data))
        (:data structured)
        (errors/fail "INVALID_RESPONSE" "The server returned an unreadable response.")))))

(defn account
  "Call `account_status`. The tool takes no arguments."
  [client]
  (call client "account_status" {}))

(defn models
  "Call `list_models`. The tool takes no arguments."
  [client]
  (call client "list_models" {}))

(defn model
  "Call `get_model` for one of the published model ids."
  [client model-id]
  (validate/validate-model-id model-id)
  (call client "get_model" {:modelId model-id}))

(defn estimate
  "Call `estimate_generation`. Omitted optional fields are not filled in.
  This call does not spend credits."
  [client input]
  (call client "estimate_generation" {:input (validate/validate-generation input)}))

(defn generate
  "Call `generate_video` only when `:confirm-spend` is exactly `true`.

  The service receives `input` and `requestId`. `:confirm-spend` is local and
  is not sent. When `:request-id` is omitted, a UUID is created after the
  confirmation check. The same id is the idempotency key on a retry."
  ([client input] (generate client input {}))
  ([client input {:keys [request-id confirm-spend]}]
   (let [input (validate/validate-generation input)]
     (when (some? request-id)
       (validate/validate-request-id request-id))
     (when-not (true? confirm-spend)
       (errors/fail "SPEND_NOT_CONFIRMED" errors/spend-not-confirmed))
     (call client "generate_video"
           {:input input
            :requestId (or request-id (str (UUID/randomUUID)))}))))

(defn tasks
  "Call `list_tasks`. A nil or omitted `:limit` is not sent."
  ([client] (tasks client {}))
  ([client {:keys [limit]}]
   (validate/validate-limit limit)
   (call client "list_tasks" (if (some? limit) {:limit limit} {}))))

(defn task
  "Call `get_task`."
  [client task-id]
  (validate/validate-task-id task-id)
  (call client "get_task" {:taskId task-id}))

(defn close
  "Drop the local MCP session. This does not call the service."
  [client]
  (protocol/close client))

(defn disconnect
  "POST `{origin}/api/mcp/disconnect/` with only the bearer token and an empty
  body. HTTP 401 from this call is `REVOCATION_UNCONFIRMED`, not a fresh
  sign-in error."
  [client]
  (protocol/disconnect client))
