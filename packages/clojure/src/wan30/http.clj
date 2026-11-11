(ns wan30.http
  {:no-doc true}
  (:require [wan30.errors :as errors])
  (:import [java.io InputStream]
           [java.net URI]
           [java.net.http HttpClient HttpClient$Redirect HttpRequest
            HttpRequest$BodyPublishers HttpResponse$BodyHandlers]
           [java.time Duration]))

(defn- read-limited [^InputStream stream max-bytes]
  (let [buffer (byte-array 8192)
        output (java.io.ByteArrayOutputStream.)]
    (try
      (loop []
        (let [n (.read stream buffer)]
          (cond
            (neg? n) (.toByteArray output)
            (> (+ (.size output) n) max-bytes)
            (errors/fail "INVALID_RESPONSE" "The server response exceeded the size limit.")
            :else
            (do
              (.write output buffer 0 n)
              (recur)))))
      (finally
        (.close stream)))))

(defn exchange
  "POST with Java's HttpClient. Redirects are not followed."
  [{:keys [method url headers body timeout-seconds max-bytes]}]
  (when-not (= method "POST")
    (errors/fail "PROTOCOL_ERROR" "The server response was lost."))
  (let [client (.. (HttpClient/newBuilder)
                   (followRedirects HttpClient$Redirect/NEVER)
                   (connectTimeout (Duration/ofSeconds timeout-seconds))
                   (build))
        payload (byte-array (or body (byte-array 0)))
        builder (.. (HttpRequest/newBuilder)
                    (uri (URI/create url))
                    (timeout (Duration/ofSeconds timeout-seconds))
                    (POST (HttpRequest$BodyPublishers/ofByteArray payload)))]
    (doseq [[name value] headers]
      (.header builder (str name) (str value)))
    (try
      (let [response (.send client
                            (.build builder)
                            (HttpResponse$BodyHandlers/ofInputStream))
            received (read-limited (.body response) max-bytes)]
        {:status (.statusCode response)
         :headers (into {}
                        (map (fn [[name values]]
                               [(.toLowerCase ^String name) (first values)]))
                        (.map (.headers response)))
         :body received})
      (catch java.io.IOException _
        (errors/fail "PROTOCOL_ERROR" "The server response was lost."))
      (catch InterruptedException _
        (.interrupt (Thread/currentThread))
        (errors/fail "PROTOCOL_ERROR" "The server response was lost.")))))
