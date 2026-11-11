(ns wan30.client-test
  (:require [clojure.data.json :as json]
            [clojure.string :as str]
            [clojure.test :refer [deftest is]]
            [wan30.client :as client]
            [wan30.http :as http]
            [wan30.protocol :as protocol]
            [wan30.validate :as validate])
  (:import [com.sun.net.httpserver HttpExchange HttpHandler HttpServer]
           [java.net InetSocketAddress]
           [java.nio.charset StandardCharsets]
           [java.util.concurrent Executors]))

(defn- bytes-of [text]
  (.getBytes ^String text StandardCharsets/UTF_8))

(defn- ok [id result session-id]
  {:status 200
   :headers {"content-type" "application/json"
             "mcp-session-id" session-id}
   :body (bytes-of (str "{\"jsonrpc\":\"2.0\",\"id\":" id ",\"result\":" result "}"))})

(defn- tool [id data session-id]
  (ok id (str "{\"structuredContent\":{\"data\":" data "}}") session-id))

(defn- accepted []
  {:status 202 :headers {} :body (byte-array 0)})

(defn- scripted [responses]
  (let [calls (atom [])
        cursor (atom 0)]
    {:calls calls
     :request (fn [request]
                (swap! calls conj request)
                (let [index @cursor]
                  (swap! cursor inc)
                  (nth responses index)))}))

(defn- make [responses]
  (let [script (scripted responses)]
    (assoc script :client (client/client {:token "test-token"
                                          :origin "https://wan30.video"
                                          :env (constantly nil)
                                          :request (:request script)}))))

(defn- parsed [call]
  (json/read-str (String. ^bytes (:body call) StandardCharsets/UTF_8) :key-fn keyword))

(defn- code [error]
  (:code (ex-data error)))

(deftest handshake-and-models
  (let [{:keys [client calls]} (make [(ok 0 "{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{}}" "session-a")
                                      (accepted)
                                      (tool 1 "{\"credits\":3}" "session-a")
                                      (tool 2 "[{\"id\":\"wan30-text-to-video\"}]" "session-a")])
        account (client/account client)]
    (is (= 3 (:credits account)))
    (is (= 3 (count @calls)))
    (let [initialize (parsed (first @calls))]
      (is (= "initialize" (:method initialize)))
      (is (= 0 (:id initialize)))
      (is (= "wan30-clj" (get-in initialize [:params :clientInfo :name])))
      (is (= "0.1.0" (get-in initialize [:params :clientInfo :version])))
      (is (not (contains? (:headers (first @calls)) "mcp-session-id"))))
    (let [notice (parsed (second @calls))]
      (is (= "notifications/initialized" (:method notice)))
      (is (not (contains? notice :id)))
      (is (not (contains? notice :params)))
      (is (= "session-a" (get (:headers (second @calls)) "mcp-session-id")))
      (is (= "2025-11-25" (get (:headers (second @calls)) "mcp-protocol-version"))))
    (is (= "account_status" (get-in (parsed (nth @calls 2)) [:params :name])))
    (is (= {} (get-in (parsed (nth @calls 2)) [:params :arguments])))
    (client/models client)
    (is (= "list_models" (get-in (parsed (last @calls)) [:params :name])))
    (is (= 2 (:id (parsed (last @calls)))))))

(deftest estimate-does-not-inject-defaults-or-confirmation
  (let [{:keys [client calls]} (make [(ok 0 "{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{}}" "session-a")
                                      (accepted)
                                      (tool 1 "{\"quoted\":true}" "session-a")])
        input {:modelId "wan30-text-to-video" :prompt "A paper boat"}
        quote (client/estimate client input)
        sent (get-in (parsed (last @calls)) [:params :arguments :input])]
    (is (true? (:quoted quote)))
    (is (= "wan30-text-to-video" (:modelId sent)))
    (is (= "A paper boat" (:prompt sent)))
    (is (not (contains? sent :durationSeconds)))
    (is (not (contains? sent :resolution)))
    (is (not (contains? sent :confirmSpend)))
    (is (not (str/includes? (String. ^bytes (:body (last @calls)) StandardCharsets/UTF_8)
                            "confirmSpend")))))

(deftest generate-without-confirmation-does-not-call
  (let [{:keys [client calls]} (make [])
        input {:modelId "wan30-text-to-video" :prompt "A paper boat"}]
    (is (thrown-with-msg?
         clojure.lang.ExceptionInfo
         #"purchased wan30.video credits"
         (client/generate client input {:request-id "paper-boat-request"})))
    (try
      (client/generate client input)
      (catch clojure.lang.ExceptionInfo error
        (is (= "SPEND_NOT_CONFIRMED" (code error)))
        (is (str/includes? (ex-message error) "check-in"))))
    (is (empty? @calls))))

(deftest generate-sends-request-id-and-not-the-local-flag
  (let [{:keys [client calls]} (make [(ok 0 "{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{}}" "session-a")
                                      (accepted)
                                      (tool 1 "{\"taskId\":\"task-1\"}" "session-a")
                                      (tool 2 "{\"taskId\":\"task-1\"}" "session-a")])
        input {:modelId "wan30-text-to-video" :prompt "A paper boat"}
        created (client/generate client input {:request-id "paper-boat-request"
                                               :confirm-spend true})
        arguments (get-in (parsed (last @calls)) [:params :arguments])
        body (String. ^bytes (:body (last @calls)) StandardCharsets/UTF_8)]
    (is (= "task-1" (:taskId created)))
    (is (= "paper-boat-request" (:requestId arguments)))
    (is (not (contains? arguments :confirmSpend)))
    (is (not (contains? arguments :confirm-spend)))
    (is (not (str/includes? body "confirmSpend")))
    (is (not (str/includes? body "confirm_spend")))
    (is (not (str/includes? body "confirm-spend")))
    (client/generate client input {:request-id "paper-boat-request" :confirm-spend true})
    (is (= "paper-boat-request" (get-in (parsed (last @calls)) [:params :arguments :requestId])))))

(deftest generated-request-id-matches-the-published-pattern
  (let [{:keys [client calls]} (make [(ok 0 "{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{}}" "session-a")
                                      (accepted)
                                      (tool 1 "{\"taskId\":\"task-2\"}" "session-a")])
        created (client/generate client {:modelId "wan30-text-to-video" :prompt "A paper boat"}
                                 {:confirm-spend true})
        request-id (get-in (parsed (last @calls)) [:params :arguments :requestId])]
    (is (= "task-2" (:taskId created)))
    (is (re-matches validate/request-id-re request-id))))

(deftest expired-session-resets-before-the-next-call
  (let [{:keys [client calls]} (make [{:status 401 :headers {} :body (byte-array 0)}
                                      (ok 0 "{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{}}" "session-b")
                                      (accepted)
                                      (tool 1 "[]" "session-b")])]
    (try
      (client/tasks client)
      (catch clojure.lang.ExceptionInfo error
        (is (= "AUTH_REQUIRED" (code error)))
        (is (= 401 (:status (ex-data error))))
        (is (str/includes? (ex-message error) "wan30 auth login"))))
    (let [tasks (client/tasks client {:limit 20})]
      (is (= [] tasks))
      (is (= 1 (:id (parsed (last @calls)))))
      (is (= 20 (get-in (parsed (last @calls)) [:params :arguments :limit])))
      (is (= "session-b" (get (:headers (last @calls)) "mcp-session-id"))))))

(deftest tool-error-uses-the-published-code
  (let [body (str "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"isError\":true,\"content\":"
                  "[{\"type\":\"text\",\"text\":\"{\\\"code\\\":\\\"QUOTE_REQUIRED\\\",\\\"message\\\":\\\"Estimate first.\\\"}\"}]}}")
        {:keys [client calls]} (make [(ok 0 "{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{}}" "session-a")
                                      (accepted)
                                      {:status 200
                                       :headers {"content-type" "application/json; charset=utf-8"
                                                 "mcp-session-id" "session-a"}
                                       :body (bytes-of body)}])]
    (try
      (client/task client "task-1")
      (catch clojure.lang.ExceptionInfo error
        (is (= "QUOTE_REQUIRED" (code error)))
        (is (= "Estimate first." (ex-message error)))))
    (is (= "task-1" (get-in (parsed (last @calls)) [:params :arguments :taskId])))))

(deftest accepted-tool-response-is-not-a-result
  (let [{:keys [client]} (make [(ok 0 "{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{}}" "session-a")
                                (accepted)
                                (accepted)])]
    (try
      (client/model client "wan30-text-to-video")
      (catch clojure.lang.ExceptionInfo error
        (is (= "INVALID_RESPONSE" (code error)))
        (is (= 202 (:status (ex-data error))))))))

(deftest validation-rejects-an-http-image-and-a-boolean-duration
  (is (thrown-with-msg?
       clojure.lang.ExceptionInfo
       #"HTTPS URLs"
       (validate/validate-generation
        {:prompt "A paper boat"
         :imageUrls ["http://cdn.example/a.png"]})))
  (is (thrown-with-msg?
       clojure.lang.ExceptionInfo
       #"integer"
       (validate/validate-generation
        {:modelId "wan30-text-to-video"
         :prompt "A paper boat"
         :durationSeconds true})))
  (is (= "https://wan30.video" (validate/normalize-origin "https://wan30.video")))
  (is (thrown? clojure.lang.ExceptionInfo
               (validate/normalize-origin "https://wan30.video:443"))))

(deftest environment-lookup-does-not-read-a-file
  (try
    (client/client {:env (constantly nil)})
    (is false "missing token should fail")
    (catch clojure.lang.ExceptionInfo error
      (is (= "INVALID_TOKEN" (code error)))))
  (let [built (client/client {:env (fn [name]
                                     (get {"WAN30_ACCESS_TOKEN" "test-token"
                                           "WAN30_ORIGIN" "https://wan30.video"}
                                          name))})]
    (is (= "https://wan30.video" (:origin built)))))

(deftest disconnect-does-not-treat-401-as-a-fresh-login-error
  (let [calls (atom [])
        cursor (atom 0)
        responses [{:status 401 :headers {} :body (byte-array 0)}
                   {:status 204 :headers {} :body (byte-array 0)}]
        request (fn [req]
                  (swap! calls conj req)
                  (let [index @cursor]
                    (swap! cursor inc)
                    (nth responses index)))
        denied (client/client {:token "test-token" :env (constantly nil) :request request})]
    (try
      (client/disconnect denied)
      (catch clojure.lang.ExceptionInfo error
        (is (= "REVOCATION_UNCONFIRMED" (code error)))
        (is (= 401 (:status (ex-data error))))))
    (is (= "https://wan30.video/api/mcp/disconnect/" (:url (first @calls))))
    (is (not (contains? (:headers (first @calls)) "mcp-session-id")))
    (is (zero? (alength ^bytes (:body (first @calls)))))
    (is (= protocol/auth-response-limit (:max-bytes (first @calls))))
    (client/disconnect (client/client {:token "test-token" :env (constantly nil) :request request}))
    (is (= "https://wan30.video/api/mcp/disconnect/" (:url (second @calls))))))

(deftest sse-message-is-read
  (let [messages (protocol/parse-sse
                  (bytes-of "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n\n"))]
    (is (= 1 (count messages)))
    (is (= 1 (:id (first messages))))
    (is (true? (get-in (first messages) [:result :ok])))))

(deftest java-http-does-not-follow-redirects
  (let [landed (atom false)
        server (HttpServer/create (InetSocketAddress. "127.0.0.1" 0) 0)
        pool (Executors/newCachedThreadPool)
        port (.getPort (.getAddress server))]
    (.setExecutor server pool)
    (.createContext server "/landed"
                    (reify HttpHandler
                      (handle [_ exchange]
                        (reset! landed true)
                        (.sendResponseHeaders ^HttpExchange exchange 200 -1)
                        (.close exchange))))
    (.createContext server "/redirect"
                    (reify HttpHandler
                      (handle [_ exchange]
                        (.add (.getResponseHeaders exchange)
                              "Location"
                              (str "http://127.0.0.1:" port "/landed"))
                        (.sendResponseHeaders ^HttpExchange exchange 302 -1)
                        (.close exchange))))
    (.start server)
    (let [response (try
                     (http/exchange {:method "POST"
                                     :url (str "http://127.0.0.1:" port "/redirect")
                                     :headers {}
                                     :body (byte-array 0)
                                     :timeout-seconds 5
                                     :max-bytes 1024})
                     (finally
                       (.stop server 0)
                       (.shutdownNow pool)))]
      (is (= 302 (:status response)))
      (is (false? @landed)))))

(defn -main [& _]
  (let [{:keys [fail error]} (clojure.test/run-tests 'wan30.client-test)]
    (System/exit (+ fail error))))
