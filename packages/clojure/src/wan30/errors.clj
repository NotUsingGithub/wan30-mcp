(ns wan30.errors
  {:no-doc true})

(def spend-not-confirmed
  "generate spends purchased wan30.video credits. Sign-up, check-in and gift credits alone do not qualify. Pass confirmSpend=true after estimate().")

(def auth-required-message
  "Authorization expired or was revoked. Run wan30 auth login.")

(def origin-message
  "Use an exact HTTPS service origin.")

(defn fail
  ([code message]
   (fail code message nil))
  ([code message status]
   (fail code message status nil))
  ([code message status rpc-code]
   (throw (ex-info message {:code code
                            :status status
                            :rpc-code rpc-code}))))
